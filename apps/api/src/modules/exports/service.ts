import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { and, desc, eq } from 'drizzle-orm';
import {
  CHANNEL_CONFIG,
  CHANNEL_LABEL_NL,
  COURSE_FACT_LABEL_NL,
  FIT_VERDICT_LABEL_NL,
  FUNNEL_STAGE_LABEL_NL,
  FUNNEL_STAGES,
  GATE_LABEL_NL,
  isPublishable,
  PUBLISH_READY_GATES,
  unconfirmedFacts,
  type ContentAssetVersion,
  type ContentPlan,
  type CurrentUser,
  type ExportKind,
  type ExportRecord,
  type FunnelStage,
  type WorkflowGate,
} from '@c360/contracts';
import type { Db } from '../../core/db/types.js';
import { assets, exports as exportsTable } from '../../core/db/schema.js';
import { AppError } from '../../core/errors/app-error.js';
import { requireLabelPermission } from '../../core/authz/policy.js';
import { buildEmailHtml } from '../../core/render/email-html.js';
import type { BrandService } from '../brand/service.js';
import type { CourseService } from '../courses/service.js';
import type { CampaignService } from '../campaigns-briefs/service.js';
import type { ConceptService } from '../concepts/service.js';
import type { ContentAssetService } from '../content-assets/service.js';

/**
 * Export packages.
 *
 * The distinction that carries the most weight: a **draft** export is always
 * available and is labelled a draft inside the package itself; a
 * **publish-ready** package is refused unless every gate passes, and the
 * refusal lists the reasons in Dutch so the user knows what to fix.
 *
 * The package contains files the user takes elsewhere. Nothing is published,
 * no advertising account is contacted, and "approved" is deliberately not the
 * same as "published" — publication is something the user records afterwards.
 */

export interface ExportResult {
  record: ExportRecord;
  /** Absent when a publish-ready export was refused. */
  storagePath: string | null;
}

export class ExportService {
  constructor(
    private readonly storageRoot: string,
    private readonly brand: BrandService,
    private readonly courses: CourseService,
    private readonly campaigns: CampaignService,
    private readonly concepts: ConceptService,
    private readonly content: ContentAssetService,
  ) {}

  /**
   * Evaluates the publish-ready gates against real database state.
   *
   * Every gate is a query, never a stored flag — so it cannot be out of date.
   */
  async evaluateGates(
    db: Db,
    user: CurrentUser,
    labelId: string,
    campaignId: string,
  ): Promise<{ passed: Set<WorkflowGate>; reasonsNl: string[] }> {
    const passed = new Set<WorkflowGate>();
    const reasonsNl: string[] = [];

    const campaign = await this.campaigns.requireById(db, labelId, campaignId);
    const course = await this.courses.requireVersion(db, labelId, campaign.courseVersionId);
    const brandProfile = await this.brand.approved(db, labelId);
    const assetsList = await this.content.list(db, user, labelId, campaignId);

    // course_version_confirmed
    const outstanding = unconfirmedFacts(course);
    if (course.reviewState === 'approved' && outstanding.length === 0) {
      passed.add('course_version_confirmed');
    } else {
      reasonsNl.push(
        outstanding.length > 0
          ? `Opleidingsinformatie is nog niet volledig gecontroleerd: ${outstanding.map((f) => COURSE_FACT_LABEL_NL[f]).join(', ')}.`
          : 'De opleidingskaart is nog niet goedgekeurd.',
      );
    }

    // brand_profile_approved
    if (brandProfile !== undefined) {
      passed.add('brand_profile_approved');
    } else {
      reasonsNl.push('Er is geen goedgekeurd merkprofiel voor dit label.');
    }

    // all_assets_have_current_approval
    const unapproved = assetsList.filter((asset) => asset.reviewState !== 'approved');
    if (assetsList.length > 0 && unapproved.length === 0) {
      passed.add('all_assets_have_current_approval');
    } else if (assetsList.length === 0) {
      reasonsNl.push('Er is nog geen content om te exporteren.');
    } else {
      reasonsNl.push(
        `${String(unapproved.length)} van ${String(assetsList.length)} contentitems is nog niet goedgekeurd.`,
      );
    }

    // no_stale_dependencies
    const stale = assetsList.filter((asset) => asset.reviewState === 'needs_rereview');
    if (stale.length === 0) {
      passed.add('no_stale_dependencies');
    } else {
      reasonsNl.push(
        `${String(stale.length)} contentitem(s) moet(en) opnieuw worden beoordeeld omdat een onderliggende bron is gewijzigd.`,
      );
    }

    // required_cta_links_present
    const missingCta = assetsList.filter(
      (asset) => asset.copy.ctaUrl === null || asset.copy.ctaUrl.trim().length === 0,
    );
    if (assetsList.length > 0 && missingCta.length === 0) {
      passed.add('required_cta_links_present');
    } else if (missingCta.length > 0) {
      reasonsNl.push(
        `${String(missingCta.length)} contentitem(s) heeft/hebben nog geen CTA-link. Voor een publicatieklaar pakket zijn die verplicht.`,
      );
    }

    // Channel specs must be verified for every channel in the package.
    const unverifiedChannels = [
      ...new Set(
        assetsList
          .filter((asset) => !isPublishable(CHANNEL_CONFIG, asset.channel, asset.format))
          .map((asset) => CHANNEL_LABEL_NL[asset.channel]),
      ),
    ];
    if (unverifiedChannels.length > 0) {
      reasonsNl.push(
        `De kanaalspecificaties van ${unverifiedChannels.join(', ')} zijn niet tegen een officiële bron gecontroleerd. Deze kanalen kunnen niet publicatieklaar worden geëxporteerd.`,
      );
    }

    return { passed, reasonsNl };
  }

  async build(
    db: Db,
    user: CurrentUser,
    labelId: string,
    campaignId: string,
    kind: ExportKind,
  ): Promise<ExportResult> {
    requireLabelPermission(
      user,
      labelId,
      kind === 'publish_ready' ? 'export:create_publish_ready' : 'export:create_draft',
    );

    const campaign = await this.campaigns.requireById(db, labelId, campaignId);
    const assetsList = await this.content.list(db, user, labelId, campaignId);
    const { passed, reasonsNl } = await this.evaluateGates(db, user, labelId, campaignId);

    const missingGates = PUBLISH_READY_GATES.filter((gate) => !passed.has(gate));
    const blocked = kind === 'publish_ready' && (missingGates.length > 0 || reasonsNl.length > 0);

    if (blocked) {
      // Recorded as a refused export, so the attempt and its reasons are part
      // of the trail rather than only a transient error message.
      const record = await this.record(db, user, {
        labelId,
        campaignId,
        kind,
        manifest: [],
        blockedReasonsNl: [
          ...reasonsNl,
          ...missingGates.map((gate) => `Niet afgerond: ${GATE_LABEL_NL[gate]}.`),
        ],
        assetId: null,
        sizeBytes: 0,
      });
      return { record, storagePath: null };
    }

    if (assetsList.length === 0) {
      throw new AppError('conflict', {
        publicMessage: 'Er is nog geen content om te exporteren.',
      });
    }

    const zip = new JSZip();
    const manifest: ExportRecord['manifest'] = [];

    /*
     * The brand profile, loaded only if something needs it.
     *
     * Only the e-mail HTML does, and most packages contain no e-mail — so this
     * is a query the common case does not pay for. `requireCurrent` rather than
     * `approved`: an e-mail rendered from a profile the label has since changed
     * would look like a mail nobody signed off.
     */
    const emailAssets = assetsList.filter((asset) => asset.channel === 'email');
    const brand =
      emailAssets.length === 0 ? null : await this.brand.requireCurrent(db, labelId);

    // A draft package says so in its own README, so a file that leaves this
    // system cannot be mistaken for approved material.
    const readme = buildReadme(kind, campaign.name, reasonsNl);
    zip.file('LEESMIJ.txt', readme);
    manifest.push({
      path: 'LEESMIJ.txt',
      channel: null,
      variant: null,
      assetVersion: null,
      bytes: Buffer.byteLength(readme, 'utf8'),
    });

    for (const asset of assetsList) {
      /*
       * Staged content lives under its stage, `CONCEPT_ontdekken/linkedin_organic/…`,
       * because the same channel now carries a different piece per stage and
       * two of them at the same version would otherwise overwrite each other
       * in the package. Stage-less content keeps the flat folder it always had.
       */
      const folder = `${kind === 'draft' ? 'CONCEPT_' : ''}${stageFolder(asset.funnelStage)}${asset.channel}`;
      const text = buildAssetText(asset, kind);
      const textPath = `${folder}/tekst-v${String(asset.version)}.txt`;
      zip.file(textPath, text);
      manifest.push({
        path: textPath,
        channel: asset.channel,
        variant: null,
        assetVersion: asset.version,
        bytes: Buffer.byteLength(text, 'utf8'),
      });

      /*
       * An e-mail also travels as HTML, because that is the artefact.
       *
       * The plain-text file above is still written and is not a courtesy: it is
       * what a reader checks the wording in, and what survives a client that
       * strips everything. The HTML is generated here from the same structured
       * copy — no markup ever comes from the model, so there is nothing to
       * sanitise (`core/render/email-html.ts`).
       *
       * Nothing is sent. This is a file.
       */
      if (asset.channel === 'email' && brand !== null) {
        const html = buildEmailHtml({
          asset,
          brand,
          draftNoticeNl:
            kind === 'draft'
              ? 'CONCEPT — deze e-mail is niet goedgekeurd en niet verzonden. Controleer de weergave in je eigen verzendtool voordat je hem gebruikt.'
              : 'Controleer de weergave in je eigen verzendtool voordat je verzendt. Dit systeem verzendt niets.',
        });
        const htmlPath = `${folder}/email-v${String(asset.version)}.html`;
        zip.file(htmlPath, html);
        manifest.push({
          path: htmlPath,
          channel: asset.channel,
          variant: null,
          assetVersion: asset.version,
          bytes: Buffer.byteLength(html, 'utf8'),
        });
      }

      for (const variant of asset.variants) {
        if (variant.imageAssetId === null) {
          continue;
        }
        const rows = await db
          .select({ storagePath: assets.storagePath, byteSize: assets.byteSize })
          .from(assets)
          .where(and(eq(assets.id, variant.imageAssetId), eq(assets.labelId, labelId)))
          .limit(1);
        const stored = rows[0];
        if (stored === undefined) {
          continue;
        }
        const bytes = await readFile(path.join(this.storageRoot, stored.storagePath));
        const imagePath = `${folder}/variant-${variant.variant}-v${String(asset.version)}.png`;
        zip.file(imagePath, bytes);
        manifest.push({
          path: imagePath,
          channel: asset.channel,
          variant: variant.variant,
          assetVersion: asset.version,
          bytes: stored.byteSize,
        });
      }
    }

    // The plan travels with the package, so the recipient knows the intended
    // rhythm rather than receiving loose files.
    const plan = await this.concepts.latestPlan(db, campaignId);
    if (plan !== undefined) {
      const planText = buildPlanText(plan.plan);
      zip.file('publicatieplan.txt', planText);
      manifest.push({
        path: 'publicatieplan.txt',
        channel: null,
        variant: null,
        assetVersion: plan.version,
        bytes: Buffer.byteLength(planText, 'utf8'),
      });
    }

    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const storagePath = path.posix.join(
      'labels',
      labelId.replace(/[^a-zA-Z0-9-]/gu, ''),
      'exports',
      `${sha256.slice(0, 16)}-${kind}.zip`,
    );
    const absolute = path.join(this.storageRoot, storagePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, buffer);

    /*
     * The insert has to tolerate a conflict, and must not name its target.
     *
     * A conflict is rare but real: the package embeds its own export time, so
     * two exports normally differ, but two requests landing in the same
     * instant — a double click — produce identical bytes, the same hash, and a
     * collision on the unique index. Without a conflict clause that is a 500
     * for the second click.
     *
     * The target cannot be named. The unique index on `assets` is
     * partial — `(label_id, sha256, kind) WHERE kind <> 'generated_image'`,
     * from migration 0010 — and PostgreSQL refuses to infer a partial index
     * unless the statement repeats its predicate. Naming the columns alone
     * fails the whole statement with 42P10, "no unique or exclusion constraint
     * matching the ON CONFLICT specification", which is how every draft export
     * came to answer 500 — and note that this fails when the statement is
     * planned, so it failed for *every* export, not only for a colliding one:
     * the index changed under a call that had been correct when it was written.
     * Repeating the predicate here would put a copy of the index definition in
     * application code and break the same way at the next change, so the
     * predicate stays in the migration and this insert says only that a
     * conflict is acceptable.
     */
    const inserted = await db
      .insert(assets)
      .values({
        organizationId: user.organizationId,
        labelId,
        kind: 'export',
        mimeType: 'application/zip',
        byteSize: buffer.byteLength,
        sha256,
        storagePath,
        createdByUserId: user.userId,
      })
      .onConflictDoNothing()
      .returning({ id: assets.id });

    /*
     * A conflict means the package already exists, so its row is looked up
     * rather than left out. Recording `null` here would produce an export row
     * the interface offers no download for, which is a worse failure than the
     * crash it replaced: it looks like it worked.
     */
    const existing =
      inserted[0] === undefined
        ? await db
            .select({ id: assets.id })
            .from(assets)
            .where(
              and(
                eq(assets.labelId, labelId),
                eq(assets.sha256, sha256),
                eq(assets.kind, 'export'),
              ),
            )
            .limit(1)
        : [];
    const assetId = inserted[0]?.id ?? existing[0]?.id;
    if (assetId === undefined) {
      throw new AppError('internal_error', {
        internalDetail: 'export asset row was neither inserted nor found',
      });
    }

    const record = await this.record(db, user, {
      labelId,
      campaignId,
      kind,
      manifest,
      blockedReasonsNl: [],
      assetId,
      sizeBytes: buffer.byteLength,
    });

    return { record, storagePath };
  }

  async list(db: Db, user: CurrentUser, labelId: string, campaignId: string): Promise<ExportRecord[]> {
    requireLabelPermission(user, labelId, 'export:read');
    const rows = await db
      .select()
      .from(exportsTable)
      .where(and(eq(exportsTable.labelId, labelId), eq(exportsTable.campaignId, campaignId)))
      .orderBy(desc(exportsTable.createdAt))
      .limit(20);
    return rows.map(toExport);
  }

  /** Resolves an export's file for an authorised download. */
  async storagePathFor(db: Db, user: CurrentUser, labelId: string, exportId: string): Promise<string> {
    requireLabelPermission(user, labelId, 'export:read');
    const rows = await db
      .select({ assetId: exportsTable.assetId })
      .from(exportsTable)
      .where(and(eq(exportsTable.id, exportId), eq(exportsTable.labelId, labelId)))
      .limit(1);
    const assetId = rows[0]?.assetId;
    if (assetId === null || assetId === undefined) {
      throw AppError.notFoundOrForbidden('export', exportId);
    }
    const assetRows = await db
      .select({ storagePath: assets.storagePath })
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.labelId, labelId)))
      .limit(1);
    const storagePath = assetRows[0]?.storagePath;
    if (storagePath === undefined) {
      throw AppError.notFoundOrForbidden('export', exportId);
    }
    return storagePath;
  }

  private async record(
    db: Db,
    user: CurrentUser,
    input: {
      labelId: string;
      campaignId: string;
      kind: ExportKind;
      manifest: ExportRecord['manifest'];
      blockedReasonsNl: string[];
      assetId: string | null;
      sizeBytes: number;
    },
  ): Promise<ExportRecord> {
    const inserted = await db
      .insert(exportsTable)
      .values({
        organizationId: user.organizationId,
        labelId: input.labelId,
        campaignId: input.campaignId,
        kind: input.kind,
        manifest: input.manifest,
        blockedReasonsNl: input.blockedReasonsNl,
        assetId: input.assetId,
        sizeBytes: input.sizeBytes,
        createdByUserId: user.userId,
      })
      .returning();
    const row = inserted[0];
    if (row === undefined) {
      throw new AppError('internal_error', { internalDetail: 'export insert yielded no row' });
    }
    return toExport(row);
  }
}

function buildReadme(kind: ExportKind, campaignName: string, reasonsNl: readonly string[]): string {
  const header =
    kind === 'draft'
      ? 'CONCEPT — NIET PUBLICATIEKLAAR'
      : 'PUBLICATIEKLAAR PAKKET';

  const lines = [
    header,
    '='.repeat(header.length),
    '',
    `Campagne: ${campaignName}`,
    `Geëxporteerd: ${new Date().toISOString()}`,
    '',
  ];

  if (kind === 'draft') {
    lines.push(
      'Dit is een conceptpakket. De inhoud is nog niet volledig goedgekeurd en',
      'mag niet als definitief worden behandeld.',
      '',
    );
    if (reasonsNl.length > 0) {
      lines.push('Wat er nog open staat:', ...reasonsNl.map((reason) => `  - ${reason}`), '');
    }
  } else {
    lines.push(
      'Alle controles en goedkeuringen voor dit pakket zijn afgerond.',
      '',
    );
  }

  lines.push(
    'Belangrijk:',
    '  - Dit systeem publiceert niets zelf en koppelt geen advertentieaccounts.',
    '  - "Goedgekeurd" betekent niet "gepubliceerd". Leg publicatie zelf vast.',
    '  - Controleer teksten en beelden voordat je ze plaatst.',
  );

  return lines.join('\n');
}

function buildAssetText(asset: ContentAssetVersion, kind: ExportKind): string {
  const lines = [
    `${CHANNEL_LABEL_NL[asset.channel]} — versie ${String(asset.version)}`,
    kind === 'draft' ? '(CONCEPT)' : '',
    // The stage the piece serves, so a reader checks it against the stage's
    // message rather than against the campaign as a whole.
    asset.funnelStage === null ? '' : `Funnelfase: ${FUNNEL_STAGE_LABEL_NL[asset.funnelStage]}`,
    '',
    'HOOK',
    asset.copy.hook,
    '',
    'TEKST',
    asset.copy.body,
    '',
    'CTA',
    `${asset.copy.ctaText}${asset.copy.ctaUrl === null ? ' (link ontbreekt)' : ` → ${asset.copy.ctaUrl}`}`,
    '',
  ];

  /*
   * A page's sections, in order, before the trimmings.
   *
   * Placed straight after the introduction because that is the reading order
   * of the page itself: someone pasting this into a CMS works top to bottom.
   * Headings are marked so the structure survives a plain-text file — the
   * export is deliberately not HTML, so the structure has to be legible
   * without markup.
   */
  if (asset.copy.sections.length > 0) {
    lines.push('SECTIES');
    for (const [index, section] of asset.copy.sections.entries()) {
      lines.push(`  ${String(index + 1)}. ${section.heading}`, `     ${section.text}`, '');
    }
  }

  /*
   * Advertising copy, as separate lines rather than a paragraph.
   *
   * A platform rotates between headlines, so which line is which matters —
   * flattening them into prose would lose exactly the thing the person has to
   * paste into a form field. No figures accompany them: the contract has no
   * place for a volume or a click price, and the note says why.
   */
  if (asset.copy.ads !== null) {
    lines.push('ADVERTENTIETEKST');
    for (const [index, headline] of asset.copy.ads.headlines.entries()) {
      lines.push(`  Kop ${String(index + 1)}: ${headline}`);
    }
    for (const [index, description] of asset.copy.ads.descriptions.entries()) {
      lines.push(`  Beschrijving ${String(index + 1)}: ${description}`);
    }
    if (asset.copy.ads.keywords.length > 0) {
      lines.push('  Zoektermen (suggesties, zonder volume of klikprijs):');
      for (const keyword of asset.copy.ads.keywords) {
        lines.push(`    - ${keyword}`);
      }
    }
    lines.push(
      `  Onderbouwing: ${asset.copy.ads.rationaleNl}`,
      '  Let op: tekstlimieten en advertentieregels zijn niet gecontroleerd. Controleer ze in het advertentieplatform. Dit pakket bevat geen zoekvolumes, klikprijzen of conversieverwachtingen.',
      '',
    );
  }

  if (asset.copy.hashtags.length > 0) {
    lines.push('HASHTAGS', asset.copy.hashtags.map((tag) => `#${tag}`).join(' '), '');
  }
  if (asset.copy.imageAltText !== null) {
    lines.push('ALT-TEKST (toegankelijkheid)', asset.copy.imageAltText, '');
  }
  if (asset.warnings.length > 0) {
    lines.push(
      'AANDACHTSPUNTEN',
      ...asset.warnings.map((warning) => `  - ${warning.messageNl}`),
      '',
    );
  }

  lines.push(
    'HERKOMST',
    `  Briefing: ${asset.briefVersionId}`,
    `  Concept: ${asset.conceptVersionId}`,
    `  Merkprofiel: ${asset.brandProfileVersionId}`,
    `  Opleidingskaart: ${asset.courseVersionId}`,
    asset.editedByUserId === null ? '  Met de hand aangepast: nee' : '  Met de hand aangepast: ja',
  );

  return lines.filter((line) => line !== '').join('\n');
}

/** The folder segment for a stage: `ontdekken/`, or nothing for stage-less content. */
function stageFolder(stage: FunnelStage | null): string {
  return stage === null ? '' : `${FUNNEL_STAGE_LABEL_NL[stage].toLowerCase()}/`;
}

/**
 * The plan, with its argument.
 *
 * The recipient of a package gets not only the rhythm but *why these channels
 * for this stage*: the editorial rule and the advice for this campaign side by
 * side, exactly as the interface showed them at approval. No figures appear
 * because the advice has nowhere to carry one.
 */
function buildPlanText(plan: ContentPlan): string {
  const lines = ['PUBLICATIEPLAN', '', 'Frequentie', plan.cadenceNl, '', 'Onderbouwing', plan.rationaleNl];

  const staged = plan.items.filter((item) => item.stage !== null);
  if (staged.length > 0) {
    lines.push('', 'PER FASE');
    for (const stage of FUNNEL_STAGES) {
      const items = plan.items.filter((item) => item.stage === stage);
      if (items.length === 0) {
        continue;
      }
      lines.push(
        `  ${FUNNEL_STAGE_LABEL_NL[stage]}: ${items.map((item) => CHANNEL_LABEL_NL[item.channel]).join(', ')}`,
      );
    }
  }

  if (plan.channelAdvice.length > 0) {
    lines.push('', 'KANAALADVIES (regel · advies voor deze campagne)');
    for (const advice of plan.channelAdvice) {
      lines.push(
        `  ${FUNNEL_STAGE_LABEL_NL[advice.stage]} · ${CHANNEL_LABEL_NL[advice.channel]}: regel ${FIT_VERDICT_LABEL_NL[advice.ruleVerdict]} · advies ${FIT_VERDICT_LABEL_NL[advice.advisedVerdict]}`,
        `    ${advice.reasoningNl}`,
      );
    }
  }

  return lines.join('\n');
}

interface ExportRow {
  id: string;
  campaignId: string;
  kind: string;
  manifest: unknown;
  blockedReasonsNl: unknown;
  sizeBytes: number;
  createdByUserId: string | null;
  createdAt: Date;
}

function toExport(row: ExportRow): ExportRecord {
  return {
    id: row.id,
    campaignId: row.campaignId,
    kind: row.kind as ExportKind,
    manifest: (row.manifest ?? []) as ExportRecord['manifest'],
    blockedReasonsNl: (row.blockedReasonsNl ?? []) as string[],
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    sizeBytes: row.sizeBytes,
  };
}
