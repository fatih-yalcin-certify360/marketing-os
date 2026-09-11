import { open } from 'node:fs/promises';
import { extractPdfText } from '../../core/files/pdf-text.js';
import { extractDocxText } from '../../core/files/docx-text.js';
import { and, eq } from 'drizzle-orm';
import type { CurrentUser, Permission } from '@c360/contracts';
import { requireLabelPermission } from '../../core/authz/policy.js';
import { assets } from '../../core/db/schema.js';
import type { Db } from '../../core/db/types.js';
import { AppError } from '../../core/errors/app-error.js';
import {
  FileStore,
  validateUpload,
  type AllowedType,
  type UploadRejectionCode,
} from '../../core/files/index.js';
import type { AuditService } from '../audit/service.js';

/**
 * The upload module.
 *
 * It owns the `assets` rows of kind `upload` and nothing else. A brand profile
 * or a course card *references* an asset id; neither writes an asset row, and
 * this module never writes theirs.
 *
 * Every upload declares a **purpose**, and the purpose decides two things that
 * would otherwise be guesswork: which permission is required, and whether the
 * content must be an image or a document. Without it, a single "upload" right
 * would let anyone who can edit a course replace a brand logo.
 *
 * The order of operations is the security property worth stating:
 *
 *   authorise -> receive to quarantine -> validate -> promote or discard -> record
 *
 * A file exists on disk only in quarantine until it has passed, nothing in the
 * product can read from quarantine, and a refusal removes the bytes rather than
 * leaving them somewhere for a later bug to find.
 */

export type UploadPurpose = 'visual_reference' | 'brand_logo' | 'course_document' | 'source_document' | 'outcome_report';

interface PurposeRule {
  readonly permission: Permission;
  readonly expect: 'image' | 'document';
  readonly labelNl: string;
}

const PURPOSE_RULES: Readonly<Record<UploadPurpose, PurposeRule>> = Object.freeze({
  visual_reference: { permission: 'content:write', expect: 'image', labelNl: 'beeldreferentie' },
  brand_logo: { permission: 'brand:write', expect: 'image', labelNl: 'logo' },
  course_document: { permission: 'course:write', expect: 'document', labelNl: 'opleidingsdocument' },
  source_document: { permission: 'source:write', expect: 'document', labelNl: 'brondocument' },
  outcome_report: { permission: 'outcome:write', expect: 'document', labelNl: 'resultatenrapport' },
});

export interface UploadedAsset {
  readonly id: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly originalName: string;
  /** How this file may be handed back to a browser. */
  readonly servingMode: AllowedType['servingMode'];
  /** Set when the extension disagreed with the content. Not an error. */
  readonly warningNl?: string;
  /** True when identical content was already stored for this label. */
  readonly deduplicated: boolean;
}

export class UploadService {
  private readonly store: FileStore;

  constructor(
    storageRoot: string,
    private readonly audit: AuditService,
    private readonly maxBytes: number,
  ) {
    this.store = new FileStore(storageRoot);
  }

  /** Exposed so routes can resolve a stored path without a second resolver. */
  absolutePathFor(storagePath: string): string {
    return this.store.absolutePathFor(storagePath);
  }

  sweepQuarantine(olderThanMs: number): Promise<number> {
    return this.store.sweepQuarantine(olderThanMs);
  }

  async accept(
    db: Db,
    user: CurrentUser,
    input: {
      labelId: string;
      purpose: UploadPurpose;
      filename: string;
      declaredMime?: string | undefined;
      bytes: Buffer;
      requestId?: string | undefined;
      clientAddress?: string | undefined;
    },
  ): Promise<UploadedAsset> {
    const rule = PURPOSE_RULES[input.purpose];
    // Authorisation first: an unauthorised caller's bytes are never written
    // anywhere, not even to quarantine.
    requireLabelPermission(user, input.labelId, rule.permission);

    const { token, storagePath: quarantinePath } = await this.store.quarantine(input.bytes);

    const verdict = validateUpload({
      bytes: input.bytes,
      filename: input.filename,
      declaredMime: input.declaredMime,
      maxBytes: this.maxBytes,
      expect: rule.expect,
    });

    if (!verdict.ok) {
      await this.store.discard(quarantinePath);
      // The rejection is recorded: a stream of refused uploads is a signal, and
      // the internal `finding` belongs in the audit trail, not in the response.
      await this.audit.record(db, {
        organizationId: user.organizationId,
        labelId: input.labelId,
        actorKind: 'user',
        actorUserId: user.userId,
        action: 'upload.rejected',
        resourceType: 'upload',
        resourceId: token,
        outcome: 'denied',
        reason: verdict.code,
        // The `finding` names what was detected, never the payload itself, so
        // this record stays free of file content (requirement 13).
        metadata: {
          purpose: input.purpose,
          finding: verdict.finding,
          byteSize: input.bytes.length,
        },
        ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
        ...(input.clientAddress === undefined ? {} : { clientAddress: input.clientAddress }),
      });

      throw new AppError(rejectionCode(verdict.code), {
        publicMessage: verdict.reasonNl,
        internalDetail: `upload rejected: ${verdict.finding}`,
        context: { purpose: input.purpose, reason: verdict.code },
      });
    }

    const stored = await this.store.promote(quarantinePath, input.bytes, verdict.type.extension);

    // The unique index is (label, sha256, kind), so an identical re-upload
    // returns the existing row rather than failing. Deduplication is per label:
    // one label learning that another holds the same file would be a leak.
    const existing = await db
      .select({ id: assets.id })
      .from(assets)
      .where(
        and(
          eq(assets.labelId, input.labelId),
          eq(assets.sha256, stored.sha256),
          eq(assets.kind, 'upload'),
        ),
      )
      .limit(1);

    const id =
      existing[0]?.id ??
      (
        await db
          .insert(assets)
          .values({
            organizationId: user.organizationId,
            labelId: input.labelId,
            kind: 'upload',
            mimeType: verdict.type.mime,
            byteSize: stored.byteSize,
            sha256: stored.sha256,
            storagePath: stored.storagePath,
            originalName: verdict.displayName,
            createdByUserId: user.userId,
          })
          .returning({ id: assets.id })
      )[0]?.id;

    if (id === undefined) {
      throw new AppError('internal_error', { internalDetail: 'asset row was not written' });
    }

    await this.audit.record(db, {
      organizationId: user.organizationId,
      labelId: input.labelId,
      actorKind: 'user',
      actorUserId: user.userId,
      action: 'upload.accepted',
      resourceType: 'upload',
      resourceId: id,
      outcome: 'allowed',
      metadata: {
        purpose: input.purpose,
        mimeType: verdict.type.mime,
        byteSize: stored.byteSize,
        deduplicated: stored.deduplicated || existing.length > 0,
      },
      ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
      ...(input.clientAddress === undefined ? {} : { clientAddress: input.clientAddress }),
    });

    return {
      id,
      mimeType: verdict.type.mime,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      originalName: verdict.displayName,
      servingMode: verdict.type.servingMode,
      deduplicated: stored.deduplicated || existing.length > 0,
      ...(verdict.extensionWarningNl === undefined
        ? {}
        : { warningNl: verdict.extensionWarningNl }),
    };
  }

  async readDocument(db: Db, user: CurrentUser, labelId: string, assetId: string): Promise<{ text: string; ref: string }> {
    const asset = await this.requireForDownload(db, user, labelId, assetId);
    const file = await open(this.absolutePathFor(asset.storagePath), 'r');
    let bytes: Buffer;
    try {
      const size = (await file.stat()).size;
      if (size > Math.min(this.maxBytes, 20 * 1_048_576)) {
        throw new AppError('payload_too_large');
      }
      bytes = Buffer.alloc(size);
      const result = await file.read(bytes, 0, size, 0);
      bytes = bytes.subarray(0, result.bytesRead);
    } finally { await file.close(); }
    const extracted = asset.mimeType === 'application/pdf'
      ? await extractPdfText(bytes)
      : asset.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ? extractDocxText(bytes)
        : ['text/plain', 'text/markdown'].includes(asset.mimeType)
          ? { ok: true, text: bytes.toString('utf8').slice(0, 40_000) }
          : { ok: false, text: '', reasonNl: 'Dit bestandstype kan niet als tekstbron worden gelezen.' };
    if (!extracted.ok || !extracted.text.trim()) {
      throw new AppError('validation_failed', { publicMessage: extracted.reasonNl ?? 'Dit document bevat geen leesbare tekst.' });
    }
    return { text: extracted.text, ref: `document:${assetId} (${asset.originalName})` };
  }

  /** An upload the caller is allowed to download, or `not_found`. */
  async requireForDownload(
    db: Db,
    user: CurrentUser,
    labelId: string,
    assetId: string,
  ): Promise<{
    storagePath: string;
    mimeType: string;
    byteSize: number;
    originalName: string;
    servingMode: AllowedType['servingMode'];
  }> {
    requireLabelPermission(user, labelId, 'source:read');

    const rows = await db
      .select({
        storagePath: assets.storagePath,
        mimeType: assets.mimeType,
        byteSize: assets.byteSize,
        originalName: assets.originalName,
      })
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.labelId, labelId), eq(assets.kind, 'upload')))
      .limit(1);

    const row = rows[0];
    if (row === undefined) {
      // Not "forbidden": confirming the id exists elsewhere is the enumeration
      // channel this answer closes.
      throw AppError.notFoundOrForbidden('upload', assetId);
    }

    return {
      storagePath: row.storagePath,
      mimeType: row.mimeType,
      byteSize: row.byteSize,
      originalName: row.originalName ?? 'bestand',
      servingMode: servingModeFor(row.mimeType),
    };
  }
}

/**
 * Maps a rejection to an HTTP-shaped error code.
 *
 * `too_large` is a 413 rather than a 422 because it is a transport fact the
 * client can act on directly, and an unsupported type is a 415 for the same
 * reason.
 */
function rejectionCode(
  code: UploadRejectionCode,
): 'payload_too_large' | 'unsupported_media_type' | 'validation_failed' {
  switch (code) {
    case 'too_large':
      return 'payload_too_large';
    case 'type_not_allowed':
      return 'unsupported_media_type';
    // Everything else is a refusal about the *content* of an otherwise
    // acceptable request, which is what 422 means. Listed rather than defaulted
    // so that adding a rejection code is a compile error here.
    case 'filename_rejected':
    case 'empty':
    case 'content_mismatch':
    case 'active_content':
    case 'archive_rejected':
      return 'validation_failed';
  }
}

/**
 * Serving mode from the stored MIME type.
 *
 * Derived rather than stored, so a change to the policy applies to files that
 * were uploaded before it. Deny-by-default: anything not on the raster-image
 * list is an attachment.
 */
function servingModeFor(mimeType: string): AllowedType['servingMode'] {
  return mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/webp'
    ? 'inline_image'
    : 'attachment_only';
}
