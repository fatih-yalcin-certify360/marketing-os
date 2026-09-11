import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import type { ServerEnv } from '@c360/config';
import type { CurrentUser } from '@c360/contracts';
import { assets, campaigns } from '../db/schema.js';
import type { Db } from '../db/types.js';
import { FileStore } from '../files/storage.js';
import { requireLabelPermission } from '../authz/policy.js';
import { AppError } from '../errors/app-error.js';
import { UsageRecorder } from '../../modules/jobs-usage/usage.js';
import { BudgetService } from '../../modules/jobs-usage/budget.js';
import { AiInvalidOutputError, AiUnavailableError, type AiProvider } from './types.js';

export class VisualGenerationService {
  constructor(private readonly provider: AiProvider, private readonly env: ServerEnv) {}
  get enabled(): boolean { return this.env.AI_IMAGE_ENABLED; }
  requireCapability(): void {
    if (this.enabled && !this.provider.image()) throw new AppError('capability_unavailable', { publicMessage: 'AI-beeldgeneratie is niet beschikbaar bij de ingestelde aanbieder.' });
  }
  async load(db: Db, user: CurrentUser, labelId: string, assetId: string): Promise<Buffer> {
    requireLabelPermission(user, labelId, 'content:write');
    const [row] = await db.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.labelId, labelId), eq(assets.kind, 'generated_image')));
    if (!row) throw AppError.notFoundOrForbidden('image', assetId);
    const bytes = await readFile(new FileStore(this.env.STORAGE_ROOT).absolutePathFor(row.storagePath));
    if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new AppError('dependency_changed');
    return bytes;
  }
  async generate(db: Db, user: CurrentUser, input: { campaignId?: string | undefined; labelId: string; prompt: string; widthPx: number; heightPx: number;
    jobId?: string | null | undefined; attempt?: number | undefined; signal?: AbortSignal | undefined;
  }): Promise<{ assetId: string; png: Buffer }> {
    requireLabelPermission(user, input.labelId, 'content:write');
    const adapter = this.provider.image();
    if (!adapter || !this.enabled) throw new AppError('capability_unavailable');
    const references: { bytes: Buffer; mimeType: string }[] = [];
    const referenceHashes: string[] = [];
    if (input.campaignId) {
      const [campaign] = await db.select().from(campaigns).where(and(eq(campaigns.id, input.campaignId), eq(campaigns.labelId, input.labelId)));
      if (!campaign) throw AppError.notFoundOrForbidden('campaign', input.campaignId);
      const ids = campaign.visualReferenceAssetIds as string[];
      for (const id of ids.slice(0, 3)) {
        const [row] = await db.select().from(assets).where(and(eq(assets.id, id), eq(assets.labelId, input.labelId), eq(assets.kind, 'upload')));
        if (!row || !['image/png', 'image/jpeg', 'image/webp'].includes(row.mimeType) || row.byteSize > 10 * 1_048_576) throw AppError.notFoundOrForbidden('reference', id);
        const bytes = await readFile(new FileStore(this.env.STORAGE_ROOT).absolutePathFor(row.storagePath));
        if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new AppError('dependency_changed');
        references.push({ bytes, mimeType: row.mimeType }); referenceHashes.push(row.sha256);
      }
    }
    const key = createHash('sha256').update(JSON.stringify([adapter.provider, adapter.model, adapter.quality, input.prompt, input.widthPx, input.heightPx, referenceHashes, 'visual-v2'])).digest('hex');
    if (input.jobId) {
      const [saved] = await db.select({ id: assets.id }).from(assets).where(and(eq(assets.labelId, input.labelId), eq(assets.aiJobId, input.jobId), eq(assets.aiRequestKey, key)));
      if (saved) return { assetId: saved.id, png: await this.load(db, user, input.labelId, saved.id) };
    }
    input.signal?.throwIfAborted();
    const estimated = adapter.estimateCostCents?.() ?? 0;
    const budget = new BudgetService(this.env.AI_DEFAULT_LABEL_BUDGET_CENTS);
    const localHold = !input.jobId && estimated > 0;
    if (localHold) await budget.reserve(db, user.organizationId, input.labelId, estimated);
    let actual: number | null = null;
    try {
      const result = await adapter.generateImage({ ...input, references });
      actual = result.usage.actualCostCents;
      // Record every paid channel separately, including calls whose bytes are unusable.
      await new UsageRecorder().record(db, { organizationId: user.organizationId, labelId: input.labelId,
        jobId: input.jobId ?? null, attempt: input.attempt ?? 0, unitKey: key, kind: 'ai_image',
        provider: adapter.provider, model: adapter.model ?? null, promptTemplate: 'content.visual', promptVersion: 'v2', imageCount: 1,
        estimatedCostCents: estimated, actualCostCents: actual, inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens, latencyMs: result.usage.latencyMs });
      const png = result.png;
      if (png.length < 24 || png.length > 25 * 1_048_576 || !png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || png.readUInt32BE(16) === 0 || png.readUInt32BE(20) === 0 || png.readUInt32BE(16) > 8192 || png.readUInt32BE(20) > 8192) {
        throw new AppError('provider_invalid_output', { publicMessage: 'De AI-aanbieder leverde geen bruikbaar PNG-beeld. Probeer opnieuw.' });
      }
      const store = new FileStore(this.env.STORAGE_ROOT);
      const quarantine = await store.quarantine(png);
      const stored = await store.promote(quarantine.storagePath, png, 'png');
      const [saved] = await db.insert(assets).values({ organizationId: user.organizationId, labelId: input.labelId, kind: 'generated_image', mimeType: 'image/png',
        ...stored, widthPx: png.readUInt32BE(16), heightPx: png.readUInt32BE(20), createdByUserId: user.userId,
        aiJobId: input.jobId ?? null, aiRequestKey: key,
        aiProvenance: { provider: adapter.provider, model: adapter.model ?? null, promptVersion: 'v2', quality: adapter.quality ?? null, referenceHashes, promptSha256: key, isMock: adapter.isMock },
      }).onConflictDoNothing().returning({ id: assets.id });
      if (saved) return { assetId: saved.id, png };
      const [existing] = await db.select({ id: assets.id }).from(assets).where(and(
        eq(assets.labelId, input.labelId), eq(assets.aiJobId, input.jobId ?? ''), eq(assets.aiRequestKey, key)));
      if (!existing) throw new AppError('internal_error');
      return { assetId: existing.id, png: await this.load(db, user, input.labelId, existing.id) };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof AiInvalidOutputError) throw new AppError('provider_invalid_output');
      throw new AppError('provider_unavailable', { publicMessage: 'AI-beeldgeneratie is mislukt. Reeds gemaakte onderdelen blijven bewaard; probeer opnieuw.', context: { retryable: error instanceof AiUnavailableError && error.retryable } });
    } finally {
      if (localHold) await budget.settle(db, input.labelId, estimated, actual ?? estimated);
    }
  }
}
