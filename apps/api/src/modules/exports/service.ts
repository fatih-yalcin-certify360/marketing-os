import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { GOOGLE_RSA, googleAdsFrameText,
  CHANNEL_CONFIG,
  CHANNEL_LABEL_NL,
  COURSE_FACT_LABEL_NL,
  FIT_VERDICT_LABEL_NL,
  FUNNEL_STAGE_LABEL_NL,
  FUNNEL_STAGES,
  GATE_LABEL_NL,
  contentMarkdown,
  hardConstraintsFor,
  utmTaggedUrl,
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
    /**
     * Whether this process fabricates its output.
     *
     * Production cannot reach this state: `AI_PROVIDER=mock` is refused twice
     * when `NODE_ENV=production`. But in development the publish-ready package
     * used to leave the tool claiming every check was done, with no trace of
     * demo data anywhere in the file, while the screen did show a badge
     * (audit 2026-09-15). The rule is that development material is labelled
     * as demo, and a ZIP that is mailed on is exactly where that matters.
     */
    private readonly aiIsMock = false,
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

    // channel_specs_verified
    const unverifiedChannels = [
      ...new Set(
        assetsList
          .filter((asset) => !isPublishable(CHANNEL_CONFIG, asset.channel, asset.format))
          .map((asset) => CHANNEL_LABEL_NL[asset.channel]),
      ),
    ];
    if (unverifiedChannels.length === 0) {
      passed.add('channel_specs_verified');
    } else {
      reasonsNl.push(
        `De kanaalspecificaties van ${unverifiedChannels.join(', ')} zijn niet tegen een officiële bron gecontroleerd. Deze kanalen kunnen niet publicatieklaar worden geëxporteerd.`,
      );
    }

    // assets_within_channel_limits
    const breaches = await this.channelLimitBreaches(db, labelId, assetsList);
    if (breaches.length === 0) {
      passed.add('assets_within_channel_limits');
    } else {
      reasonsNl.push(...breaches);
    }

    return { passed, reasonsNl };
  }

  /**
   * Checks each stored image and alt text against the channel's *hard*
   * constraints.
   *
   * Those constraints — accepted upload format, pixel cap, byte cap, alt-text
   * limit — were declared in `channels.ts` and read nowhere in the API until
   * 2026-09-15: the gate above asked only whether a specification had been
   * verified, never whether the file obeyed it. A 1080×1350 PNG therefore
   * passed as publish-ready for Instagram, which accepts JPEG only.
   *
   * Reports in Dutch, one sentence per breach, naming the channel and the
   * measured value so the reader can act without opening the file.
   */
  private async channelLimitBreaches(
    db: Db,
    labelId: string,
    assetsList: readonly ContentAssetVersion[],
  ): Promise<string[]> {
    const reasons: string[] = [];
    for (const asset of assetsList) {
      const hard = hardConstraintsFor(CHANNEL_CONFIG, asset.channel, asset.format);
      if (hard === undefined) {
        continue;
      }
      const channelNl = CHANNEL_LABEL_NL[asset.channel];

      if (
        hard.altTextMaxChars !== null &&
        asset.copy.imageAltText !== null &&
        asset.copy.imageAltText.length > hard.altTextMaxChars
      ) {
        reasons.push(
          `De alt-tekst van een item voor ${channelNl} is ${String(asset.copy.imageAltText.length)} tekens; ${channelNl} staat er ${String(hard.altTextMaxChars)} toe.`,
        );
      }

      const imageIds = asset.variants
        .map((variant) => variant.imageAssetId)
        .filter((id): id is string => id !== null);
      if (imageIds.length === 0) {
        continue;
      }
      const rows = await db
        .select({
          id: assets.id,
          mimeType: assets.mimeType,
          byteSize: assets.byteSize,
          widthPx: assets.widthPx,
          heightPx: assets.heightPx,
        })
        .from(assets)
        .where(and(inArray(assets.id, imageIds), eq(assets.labelId, labelId)));

      for (const row of rows) {
        const format = row.mimeType.replace(/^image\//u, '');
        if (!hard.imageFormats.includes(format)) {
          reasons.push(
            `Een beeld voor ${channelNl} is opgeslagen als ${format.toUpperCase()}; ${channelNl} accepteert ${hard.imageFormats.map((entry) => entry.toUpperCase()).join(' of ')}.`,
          );
        }
        if (hard.maxImageBytes !== null && row.byteSize > hard.maxImageBytes) {
          reasons.push(
            `Een beeld voor ${channelNl} is ${String(Math.round(row.byteSize / 1024))} kB; ${channelNl} staat ${String(Math.round(hard.maxImageBytes / 1024))} kB toe.`,
          );
        }
        const pixels = (row.widthPx ?? 0) * (row.heightPx ?? 0);
        if (hard.maxImagePixels !== null && pixels > hard.maxImagePixels) {
          reasons.push(
            `Een beeld voor ${channelNl} telt ${String(pixels)} pixels; ${channelNl} staat er ${String(hard.maxImagePixels)} toe.`,
          );
        }
      }
    }
    // One sentence per distinct problem: ten identical lines help nobody.
    return [...new Set(reasons)];
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
    const readme = buildReadme(kind, campaign.name, reasonsNl, this.aiIsMock);
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
      const text = buildAssetText(asset, kind, campaign.name);
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
       * A website piece also travels as Markdown.
       *
       * The `.txt` is for reading; a change proposal or an article has to be
       * *placed*, and every CMS worth the name takes Markdown while none takes
       * our plain-text layout. The builder is the same one the screen's "copy
       * as Markdown" button uses, so the file and the button cannot drift
       * (audit 2026-09-15).
       */
      if (asset.copy.website !== null) {
        const markdown = contentMarkdown(asset);
        const markdownPath = `${folder}/tekst-v${String(asset.version)}.md`;
        zip.file(markdownPath, markdown);
        manifest.push({
          path: markdownPath,
          channel: asset.channel,
          variant: null,
          assetVersion: asset.version,
          bytes: Buffer.byteLength(markdown, 'utf8'),
        });
      }

      /*
       * A Google Search ad also travels as a hand-off sheet: one row with the
       * headlines, descriptions, paths and final URL, then a row per keyword
       * and per negative keyword. It is for the person who builds the
       * campaign in Google Ads or its Editor, not an upload the system
       * performs, and the column names are ours; the LEESMIJ says so.
       */
      if (asset.channel === 'google_search_ads' && asset.copy.ads !== null) {
        const csv = buildGoogleAdsSheet(asset, kind, campaign.name);
        const csvPath = `${folder}/google-ads-v${String(asset.version)}.csv`;
        zip.file(csvPath, csv);
        manifest.push({
          path: csvPath,
          channel: asset.channel,
          variant: null,
          assetVersion: asset.version,
          bytes: Buffer.byteLength(csv, 'utf8'),
        });
      }

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
          .select({ storagePath: assets.storagePath, byteSize: assets.byteSize, mimeType: assets.mimeType })
          .from(assets)
          .where(and(eq(assets.id, variant.imageAssetId), eq(assets.labelId, labelId)))
          .limit(1);
        const stored = rows[0];
        if (stored === undefined) {
          continue;
        }
        const bytes = await readFile(path.join(this.storageRoot, stored.storagePath));
        // The extension follows the stored bytes. Social channels are rendered
        // as JPEG since 2026-09-15; a `.png` name on JPEG bytes is refused by
        // the very upload it is meant for.
        const extension = stored.mimeType === 'image/jpeg' ? 'jpg' : 'png';
        const imagePath = `${folder}/variant-${variant.variant}-v${String(asset.version)}.${extension}`;
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

function buildReadme(
  kind: ExportKind,
  campaignName: string,
  reasonsNl: readonly string[],
  aiIsMock: boolean,
): string {
  const header = aiIsMock
    ? 'DEMO — NIET PUBLICEREN'
    : kind === 'draft'
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

  // The badge on screen never reached the file. A ZIP is the thing that gets
  // forwarded, so the warning belongs at the top of it (audit 2026-09-15).
  if (aiIsMock) {
    lines.push(
      'Deze teksten en beelden zijn verzonnen door de demo-aanbieder van dit',
      'systeem. Ze beschrijven geen echte opleiding, prijs of voorwaarde en',
      'mogen nergens worden gepubliceerd of gedeeld als voorstel.',
      '',
    );
  }

  if (kind === 'draft') {
    lines.push(
      'Dit is een conceptpakket. De inhoud is nog niet volledig goedgekeurd en',
      'mag niet als definitief worden behandeld.',
      '',
    );
    if (reasonsNl.length > 0) {
      lines.push('Wat er nog open staat:', ...reasonsNl.map((reason) => `  - ${reason}`), '');
    }
  } else if (aiIsMock) {
    lines.push(
      'De controles en goedkeuringen in dit systeem zijn afgerond, maar over',
      'demomateriaal. Dat maakt het niet publicatieklaar.',
      '',
    );
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

function buildAssetText(asset: ContentAssetVersion, kind: ExportKind, campaignName: string): string {
  /*
   * The published link carries campaign tagging; the stored one does not.
   *
   * No platform requires it — LinkedIn calls tracking parameters optional and
   * Google enforces only a domain match — so this is our own choice, made
   * because an untagged click lands in the website's analytics as "direct" and
   * the campaign that earned it cannot be told apart (audit 2026-09-15). A link
   * that already carries `utm_source` is left exactly as the marketer wrote it.
   */
  const tagged = utmTaggedUrl({
    url: asset.copy.ctaUrl,
    channel: asset.channel,
    campaignName,
    stage: asset.funnelStage,
    assetKey: asset.assetKey,
  });
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
    `${asset.copy.ctaText}${tagged === null ? ' (link ontbreekt)' : ` → ${tagged}`}`,
    // Said out loud, because the link in the file is not byte-for-byte the one
    // that was approved. Nothing is rewritten in the database; the tagging
    // happens here, on the way out.
    tagged !== null && tagged !== asset.copy.ctaUrl
      ? `  (campagnemarkering toegevoegd voor toewijzing; de goedgekeurde link is ${String(asset.copy.ctaUrl)})`
      : '',
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
    const ads = asset.copy.ads;
    const google = asset.channel === 'google_search_ads';
    lines.push('ADVERTENTIETEKST');
    if (google) lines.push('  Responsieve zoekadvertentie (Google Ads)');
    for (const [index, headline] of ads.headlines.entries()) {
      lines.push(`  Kop ${String(index + 1)}: ${headline}${google ? ` (${String([...headline].length)}/${String(GOOGLE_RSA.headlines.maxChars)})` : ''}`);
    }
    for (const [index, description] of ads.descriptions.entries()) {
      lines.push(`  Beschrijving ${String(index + 1)}: ${description}${google ? ` (${String([...description].length)}/${String(GOOGLE_RSA.descriptions.maxChars)})` : ''}`);
    }
    if (ads.paths.length > 0) lines.push(`  Weergavepaden: ${ads.paths.join(' / ')}`);
    if (ads.finalUrl !== null) lines.push(`  Uiteindelijke URL: ${ads.finalUrl}`);
    if (ads.keywords.length > 0) {
      lines.push('  Zoektermen (suggesties, zonder volume of klikprijs):');
      for (const keyword of ads.keywords) {
        lines.push(`    - ${keyword}`);
      }
    }
    if (ads.negativeKeywords.length > 0) lines.push(`  Uitsluitingszoekwoorden: ${ads.negativeKeywords.join(', ')}`);
    if (ads.matchTypeAdviceNl.length > 0) lines.push(`  Zoekwoordtype: ${ads.matchTypeAdviceNl}`);
    lines.push(`  Onderbouwing: ${ads.rationaleNl}`);
    if (google) {
      lines.push(
        `  Tekstlimieten volgens Google's documentatie (gelezen ${GOOGLE_RSA.verifiedAt.slice(0, 10)}): koppen ${String(GOOGLE_RSA.headlines.maxChars)}, beschrijvingen ${String(GOOGLE_RSA.descriptions.maxChars)}, weergavepaden ${String(GOOGLE_RSA.paths.maxChars)} tekens. Dit pakket bevat geen zoekvolumes, klikprijzen of conversieverwachtingen, en geen biedingen; die komen uit het advertentieaccount.`,
        '',
      );
      if (asset.funnelStage !== null) lines.push(googleAdsFrameText(asset.funnelStage), '');
    } else {
      lines.push(
        '  Let op: tekstlimieten en advertentieregels van dit platform zijn niet tegen een primaire bron gecontroleerd. Controleer ze in het advertentieplatform. Dit pakket bevat geen zoekvolumes, klikprijzen of conversieverwachtingen.',
        '',
      );
    }
  }

  /*
   * The website piece's form, in full.
   *
   * A change proposal lists, per change, where on the page, why, the passage
   * that is there now and the text that should follow — the four things a
   * web editor needs to act without re-reading the campaign. An article is
   * printed in reading order with its search snippet and its questions, so
   * it can be pasted into a CMS top to bottom.
   */
  if (asset.copy.website?.form === 'course_page_update') {
    lines.push('WIJZIGINGSVOORSTEL OPLEIDINGSPAGINA', `  Pagina: ${asset.copy.website.pageUrl}`, '');
    for (const [index, change] of asset.copy.website.changes.entries()) {
      lines.push(
        `  Wijziging ${String(index + 1)} — ${change.placement}`,
        `  Waarom: ${change.reason}`,
        `  Huidige passage: “${change.currentExcerpt}”`,
        '  Voorgestelde tekst:',
        `  ${change.proposedText}`,
        '',
      );
    }
  }
  if (asset.copy.website?.form === 'blog_article') {
    const article = asset.copy.website;
    lines.push(
      'BLOGARTIKEL',
      `  Titel: ${article.title}`,
      `  Zoekfragment (meta description): ${article.metaDescription}`,
      '',
    );
    if (article.directAnswerNl.length > 0) lines.push(`  Direct antwoord: ${article.directAnswerNl}`, '');
    lines.push(`  ${article.intro}`, '');
    for (const [index, section] of article.sections.entries()) {
      lines.push(`  ## ${section.heading}`, `  ${section.text}`, '');
      if (index === 1 && article.scenarioNl.length > 0) lines.push(`  Praktijkscenario: ${article.scenarioNl}`, '');
      if (index === article.midCtaAfterSection && article.midCtaNl.length > 0) {
        lines.push(`  ${article.midCtaNl}${asset.copy.ctaUrl === null ? '' : ` [link: ${asset.copy.ctaUrl}]`}`, '');
      }
    }
    if (article.externalFacts.length > 0) {
      lines.push('  Aangehaalde bronnen');
      for (const fact of article.externalFacts) lines.push(`  - ${fact.statementNl} — ${fact.sourceRef}`);
      lines.push('');
    }
    if (article.coursePathNl.length > 0) lines.push('  ## Wat dit van je vraagt', `  ${article.coursePathNl}`, '');
    lines.push('  Veelgestelde vragen');
    for (const item of article.faq) {
      lines.push(`  V: ${item.question}`, `  A: ${item.answer}`, '');
    }
    if (article.closingCtaNl.length > 0) lines.push(`  ${article.closingCtaNl}`, '');
    lines.push(
      `  Interne link naar de opleidingspagina: “${article.internalLinkText}”${asset.copy.ctaUrl === null ? '' : ` → ${asset.copy.ctaUrl}`}`,
      '',
    );
  }
  if (asset.copy.keywordsUsed.length > 0) {
    lines.push('ZOEKTERMEN IN DE TEKST (geen volume, geen positie)', `  ${asset.copy.keywordsUsed.join(' · ')}`, '');
  }

  if (asset.copy.hashtags.length > 0) {
    lines.push('HASHTAGS', asset.copy.hashtags.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).join(' '), '');
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

  if (plan.measurementPlan.length > 0) {
    lines.push('', 'MEETPLAN PER FASE (indicator · bron · beslisregel — geen prognose)');
    for (const measurement of plan.measurementPlan) {
      lines.push(
        `  ${FUNNEL_STAGE_LABEL_NL[measurement.stage]}: ${measurement.indicatorNl}`,
        `    Afgelezen uit: ${measurement.sourceNl}`,
        `    Beslisregel: ${measurement.decisionRuleNl}`,
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


const csvCell = (value: string): string => `"${value.replace(/"/gu, '""')}"`;

/** The responsive search ad as a spreadsheet a person pastes into Google Ads: one ad row, then keyword rows. */
export function buildGoogleAdsSheet(
  asset: ContentAssetVersion,
  kind: 'draft' | 'publish_ready',
  campaignName: string,
): string {
  const ads = asset.copy.ads;
  if (ads === null) return '';
  const stage = asset.funnelStage ?? 'zonder-fase';
  const header = [
    'Campagne',
    'Advertentiegroep',
    'Uiteindelijke URL',
    'Pad 1',
    'Pad 2',
    ...Array.from({ length: GOOGLE_RSA.headlines.max }, (_, index) => `Kop ${String(index + 1)}`),
    ...Array.from({ length: GOOGLE_RSA.descriptions.max }, (_, index) => `Beschrijving ${String(index + 1)}`),
    'Zoekterm',
    'Zoekwoordtype (advies)',
    'Uitsluitingszoekwoord',
  ];
  const campaign = `${kind === 'draft' ? 'CONCEPT ' : ''}${stage}`;
  const group = 'thema 1';
  const adRow = [
    campaign,
    group,
    // Same campaign tagging as the text file, so the sheet and the post agree.
    utmTaggedUrl({
      url: ads.finalUrl ?? asset.copy.ctaUrl,
      channel: asset.channel,
      campaignName,
      stage: asset.funnelStage,
      assetKey: asset.assetKey,
    }) ?? '',
    ads.paths[0] ?? '',
    ads.paths[1] ?? '',
    ...Array.from({ length: GOOGLE_RSA.headlines.max }, (_, index) => ads.headlines[index] ?? ''),
    ...Array.from({ length: GOOGLE_RSA.descriptions.max }, (_, index) => ads.descriptions[index] ?? ''),
    '',
    '',
    '',
  ];
  const blank = Array.from({ length: header.length - 3 }, () => '');
  const keywordRows = ads.keywords.map((keyword) => [campaign, group, ...blank.slice(2), keyword, 'woordgroep (phrase) — zie advies', '']);
  const negativeRows = ads.negativeKeywords.map((keyword) => [campaign, group, ...blank.slice(2), '', '', keyword]);
  return [header, adRow, ...keywordRows, ...negativeRows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
}
