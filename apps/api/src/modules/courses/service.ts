import { and, desc, eq } from 'drizzle-orm';
import {
  courseExtraction,
  courseDate,
  courseFactField,
  courseInput,
  emptyFact,
  unconfirmedFacts,
  type CourseFact,
  type CourseFactField,
  type CourseInput,
  type CourseVersion,
  type CurrentUser,
  type ReviewState,
} from '@c360/contracts';
import { z } from 'zod';
import type { Db, DbOrTx } from '../../core/db/types.js';
import { courseVersions } from '../../core/db/schema.js';
import { AppError } from '../../core/errors/app-error.js';
import { requireLabelPermission } from '../../core/authz/policy.js';
import type { ServerEnv } from '@c360/config';
import type { GenerationService } from '../../core/ai/generation.js';
import { extractReadableText, safeFetch } from '../../core/net/index.js';
import { extractStoredDocumentText } from '../../core/files/index.js';
import type { ApprovalService } from '../reviews-approvals/service.js';

/**
 * Course cards.
 *
 * The distinctive rule here: **verification is per field.** A value only counts
 * as usable once a person has confirmed that field, and confirmation is
 * recorded with who did it and when. Everything downstream reads
 * `statableFacts()`, so an unconfirmed price or entry condition never reaches
 * a prompt at all — which is a stronger guarantee than telling a model not to
 * mention it.
 *
 * A field left empty does not block anything. A field holding an unconfirmed
 * value does block a publish-ready export. Not stating a price is fine;
 * stating an unchecked one is not.
 */

const datesSchema = z.array(courseDate);

export class CourseService {
  constructor(
    private readonly approvals: ApprovalService,
    /**
     * Optional so the many call sites that only read or confirm a course do not
     * need them. `extractFromUrl` requires both and says so.
     */
    private readonly generation?: GenerationService,
    private readonly env?: Pick<
      ServerEnv,
      | 'RESEARCH_ALLOWED_HOST_SUFFIXES'
      | 'RESEARCH_ALLOW_HTTP'
      | 'RESEARCH_FETCH_TIMEOUT_MS'
      | 'RESEARCH_MAX_RESPONSE_BYTES'
      | 'RESEARCH_MAX_REDIRECTS'
    >,
    /**
     * Needed only by `extractFromDocument`, to resolve and read a stored
     * upload. Optional for the same reason as the two above: most course paths
     * only read or confirm a card.
     */
    private readonly uploads?: {
      requireForDownload(
        db: Db,
        user: CurrentUser,
        labelId: string,
        assetId: string,
      ): Promise<{ storagePath: string; mimeType: string; originalName: string }>;
      absolutePathFor(storagePath: string): string;
    },
  ) {}

  /**
   * Proposes a course card from a course page.
   *
   * Three properties worth naming, because each one is a rule the requirements
   * state directly:
   *
   *  - **The fetch is the guarded one.** `safeFetch` validates every redirect
   *    hop and connects to an address it has classified, so a URL a user chose
   *    cannot reach the deployment network (threat T-06).
   *  - **The page is data.** Its text goes into the user message inside a
   *    `<paginatekst>` block and the template tells the model to ignore any
   *    instruction in it. Nothing from the page reaches the system rules
   *    (threat T-05).
   *  - **Nothing is confirmed.** Every extracted field is stored `unverified`
   *    with the URL as its `sourceRef` and the extractor's own doubt in
   *    `uncertaintyNl`. An unverified field never reaches a generation prompt
   *    and blocks a publish-ready export until a person confirms it. A field
   *    the page does not mention stays **empty** — never a plausible value.
   */
  /**
   * Proposes a course card from an uploaded document.
   *
   * Same three rules as the URL path, with one difference: the bytes were
   * already validated at upload (type sniffed from content, size capped,
   * archives inspected without extraction), so this reads a file the product
   * has already judged rather than something arriving from outside.
   *
   * Everything else is identical: the document text is task data in the user
   * message, and every extracted field lands `unverified` with the document as
   * its `sourceRef`. A field the document does not mention stays empty.
   */
  async extractFromDocument(
    db: Db,
    user: CurrentUser,
    input: {
      labelId: string;
      assetId: string;
      courseKey?: string | undefined;
      jobId?: string | null;
      attempt?: number;
      signal?: AbortSignal | undefined;
      onProgress?: ((percent: number, messageNl: string) => Promise<void>) | undefined;
    },
  ): Promise<{
    course: CourseVersion;
    isMock: boolean;
    sourceRef: string;
    overallUncertaintyNl: string | null;
  }> {
    requireLabelPermission(user, input.labelId, 'course:write');

    const generation = this.generation;
    const uploads = this.uploads;
    if (generation === undefined || uploads === undefined) {
      throw new AppError('capability_unavailable', {
        publicMessage:
          'Het inlezen van een document is in deze omgeving niet beschikbaar.',
        internalDetail: 'CourseService was constructed without generation or uploads',
      });
    }

    await input.onProgress?.(10, 'Het document wordt gelezen');

    // Label-scoped, and "not found" rather than "forbidden" for another label.
    const asset = await uploads.requireForDownload(db, user, input.labelId, input.assetId);

    const extracted = await extractStoredDocumentText(
      uploads.absolutePathFor(asset.storagePath),
      asset.mimeType,
    );

    if (!extracted.ok) {
      throw new AppError('bad_request', {
        publicMessage: extracted.reasonNl ?? 'Dit document kon niet worden gelezen.',
        internalDetail: `document extraction failed: ${extracted.finding ?? 'unknown'}`,
        context: { assetId: input.assetId, mimeType: asset.mimeType },
      });
    }

    if (extracted.text.length < 200) {
      throw new AppError('bad_request', {
        publicMessage:
          'In dit document staat te weinig leesbare tekst om een opleidingskaart voor te stellen. Vul de kaart handmatig in.',
        internalDetail: `extracted ${String(extracted.text.length)} characters from ${asset.originalName}`,
      });
    }

    await input.onProgress?.(45, 'De opleidingsgegevens worden gelezen');

    const result = await generation.generate(db, {
      template: 'course.extract_from_url',
      schema: courseExtraction,
      organizationId: user.organizationId,
      labelId: input.labelId,
      jobId: input.jobId ?? null,
      attempt: input.attempt ?? 0,
      signal: input.signal,
      context: {
        language: 'nl',
        course: null,
        brand: null,
        sourceUrl: asset.originalName,
        pageText: extracted.text,
      },
    });

    await input.onProgress?.(80, 'De opleidingskaart wordt vastgelegd');

    const proposal = result.value;
    const proposedFacts: Partial<Record<CourseFactField, Partial<CourseFact>>> = {};
    for (const field of courseFactField.options) {
      const entry = proposal.facts[field];
      proposedFacts[field] = {
        value: entry.value,
        uncertaintyNl: entry.uncertaintyNl,
        // The document's own name, so a reviewer knows which file to open.
        sourceRef: asset.originalName,
        state: 'unverified',
      };
    }

    const course = await this.saveDraft(
      db,
      user,
      input.labelId,
      {
        name: proposal.name,
        externalCode: null,
        sourceKind: 'document',
        sourceRef: asset.originalName,
        courseUrl: null,
        facts: proposedFacts,
        priceCents: null,
        priceNote: null,
        dates: [],
        ...(input.courseKey === undefined ? {} : { courseKey: input.courseKey }),
      },
      // Extraction confirms nothing, whatever it was extracted from.
      { markManualAsConfirmed: false },
    );

    return {
      course,
      isMock: result.isMock,
      sourceRef: asset.originalName,
      overallUncertaintyNl: proposal.overallUncertaintyNl,
    };
  }

  async extractFromUrl(
    db: Db,
    user: CurrentUser,
    input: {
      labelId: string;
      url: string;
      courseKey?: string | undefined;
      jobId?: string | null;
      attempt?: number;
      signal?: AbortSignal | undefined;
      onProgress?: ((percent: number, messageNl: string) => Promise<void>) | undefined;
    },
  ): Promise<{
    course: CourseVersion;
    isMock: boolean;
    sourceUrl: string;
    retrievedAt: Date;
    overallUncertaintyNl: string | null;
  }> {
    requireLabelPermission(user, input.labelId, 'course:write');

    const generation = this.generation;
    const env = this.env;
    if (generation === undefined || env === undefined) {
      throw new AppError('capability_unavailable', {
        publicMessage:
          'Het inlezen van een opleidingspagina is in deze omgeving niet beschikbaar.',
        internalDetail: 'CourseService was constructed without generation or research config',
      });
    }

    await input.onProgress?.(10, 'De pagina wordt opgehaald');

    const fetched = await safeFetch(input.url, {
      allowedHostSuffixes: env.RESEARCH_ALLOWED_HOST_SUFFIXES,
      allowInsecureHttp: env.RESEARCH_ALLOW_HTTP,
      timeoutMs: env.RESEARCH_FETCH_TIMEOUT_MS,
      maxResponseBytes: env.RESEARCH_MAX_RESPONSE_BYTES,
      maxRedirects: env.RESEARCH_MAX_REDIRECTS,
    });

    if (!fetched.ok) {
      // The Dutch reason is safe to show; the finding stays internal.
      throw new AppError(fetched.code === 'timeout' ? 'provider_unavailable' : 'bad_request', {
        publicMessage: fetched.reasonNl,
        internalDetail: `course page fetch refused: ${fetched.finding}`,
        context: { code: fetched.code },
      });
    }

    const extracted = extractReadableText(fetched.body);
    if (extracted.text.length < 200) {
      throw new AppError('bad_request', {
        publicMessage:
          'Op deze pagina staat te weinig leesbare tekst om een opleidingskaart voor te stellen. Vul de kaart handmatig in.',
        internalDetail: `extracted ${String(extracted.text.length)} characters from ${fetched.finalUrl}`,
      });
    }

    await input.onProgress?.(45, 'De opleidingsgegevens worden gelezen');

    const result = await generation.generate(db, {
      template: 'course.extract_from_url',
      schema: courseExtraction,
      organizationId: user.organizationId,
      labelId: input.labelId,
      jobId: input.jobId ?? null,
      attempt: input.attempt ?? 0,
      signal: input.signal,
      context: {
        language: 'nl',
        course: null,
        brand: null,
        sourceUrl: fetched.finalUrl,
        pageText: extracted.text,
      },
    });

    await input.onProgress?.(80, 'De opleidingskaart wordt vastgelegd');

    const proposal = result.value;
    const proposedFacts: Partial<Record<CourseFactField, Partial<CourseFact>>> = {};
    for (const field of courseFactField.options) {
      const entry = proposal.facts[field];
      proposedFacts[field] = {
        value: entry.value,
        uncertaintyNl: entry.uncertaintyNl,
        // The final URL, after redirects: the page the text actually came from.
        sourceRef: fetched.finalUrl,
        state: 'unverified',
      };
    }

    const course = await this.saveDraft(
      db,
      user,
      input.labelId,
      {
        name: proposal.name,
        externalCode: null,
        sourceKind: 'course_page_url',
        sourceRef: fetched.finalUrl,
        courseUrl: fetched.finalUrl,
        facts: proposedFacts,
        priceCents: null,
        priceNote: null,
        dates: [],
        ...(input.courseKey === undefined ? {} : { courseKey: input.courseKey }),
      },
      // The decisive option: extraction confirms nothing.
      { markManualAsConfirmed: false },
    );

    return {
      course,
      isMock: result.isMock,
      sourceUrl: fetched.finalUrl,
      retrievedAt: fetched.retrievedAt,
      overallUncertaintyNl: proposal.overallUncertaintyNl,
    };
  }

  async listLatestPerCourse(
    db: Db,
    user: CurrentUser,
    labelId: string,
    limit: number,
  ): Promise<CourseVersion[]> {
    requireLabelPermission(user, labelId, 'course:read');
    const rows = await db
      .select()
      .from(courseVersions)
      .where(eq(courseVersions.labelId, labelId))
      .orderBy(desc(courseVersions.createdAt))
      .limit(limit);

    // Keep only the highest version per course_key.
    const byKey = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const existing = byKey.get(row.courseKey);
      if (existing === undefined || row.version > existing.version) {
        byKey.set(row.courseKey, row);
      }
    }
    return [...byKey.values()].map(toCourse);
  }

  async findVersion(db: DbOrTx, labelId: string, id: string): Promise<CourseVersion | undefined> {
    const rows = await db
      .select()
      .from(courseVersions)
      .where(and(eq(courseVersions.id, id), eq(courseVersions.labelId, labelId)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toCourse(row);
  }

  async requireVersion(db: DbOrTx, labelId: string, id: string): Promise<CourseVersion> {
    const course = await this.findVersion(db, labelId, id);
    if (course === undefined) {
      throw AppError.notFoundOrForbidden('course', id);
    }
    return course;
  }

  /**
   * Creates a course, or the next version of an existing one.
   *
   * Manually entered values are marked `user_confirmed` immediately, because
   * the person typing them *is* the confirmation. Extracted values arrive as
   * `unverified` and stay that way until someone confirms them — which is what
   * `confirmFacts` is for.
   */
  async saveDraft(
    db: Db,
    user: CurrentUser,
    labelId: string,
    input: CourseInput & { courseKey?: string | undefined },
    options: { markManualAsConfirmed?: boolean | undefined } = {},
  ): Promise<CourseVersion> {
    requireLabelPermission(user, labelId, 'course:write');
    const parsed = courseInput.parse(input);
    const courseKey = input.courseKey ?? slugifyCourseName(parsed.name);
    const confirmManual = options.markManualAsConfirmed ?? parsed.sourceKind === 'manual';

    return db.transaction(async (tx) => {
      const previous = await this.latestForKey(tx, labelId, courseKey);
      const next = (previous?.version ?? 0) + 1;

      // Start from the previous version's facts so a revision does not silently
      // drop a field the user did not touch.
      const facts = buildFacts(previous?.facts, parsed.facts, {
        confirmManual,
        userId: user.userId,
      });

      const inserted = await tx
        .insert(courseVersions)
        .values({
          organizationId: user.organizationId,
          labelId,
          courseKey,
          version: next,
          name: parsed.name,
          externalCode: parsed.externalCode,
          sourceKind: parsed.sourceKind,
          sourceRef: parsed.sourceRef,
          courseUrl: parsed.courseUrl,
          facts,
          // Structured price/dates only survive when their fact is confirmed.
          priceCents: facts.price.state === 'user_confirmed' ? parsed.priceCents : null,
          priceNote: facts.price.state === 'user_confirmed' ? parsed.priceNote : null,
          dates: facts.dates.state === 'user_confirmed' ? parsed.dates : [],
          reviewState: 'draft',
          origin: parsed.sourceKind === 'manual' ? 'user' : 'extracted',
          createdByUserId: user.userId,
        })
        .returning();

      const row = inserted[0];
      if (row === undefined) {
        throw new AppError('internal_error', { internalDetail: 'course insert yielded no row' });
      }
      return toCourse(row);
    });
  }

  /**
   * Confirms specific factual fields.
   *
   * Creates a new version rather than updating the row, so "who confirmed the
   * price, and when" stays part of the immutable record.
   */
  async confirmFacts(
    db: Db,
    user: CurrentUser,
    labelId: string,
    versionId: string,
    fields: readonly CourseFactField[],
  ): Promise<CourseVersion> {
    requireLabelPermission(user, labelId, 'course:write');

    return db.transaction(async (tx) => {
      const current = await this.requireVersion(tx, labelId, versionId);
      const facts = { ...current.facts };
      const now = new Date().toISOString();

      for (const field of fields) {
        const fact = facts[field];
        if (fact.value === null) {
          throw new AppError('validation_failed', {
            publicMessage: `Je kunt "${field}" niet bevestigen zonder waarde. Vul het veld eerst in.`,
          });
        }
        facts[field] = {
          ...fact,
          state: 'user_confirmed',
          confirmedByUserId: user.userId,
          confirmedAt: now,
        };
      }

      const next = current.version + 1;
      const inserted = await tx
        .insert(courseVersions)
        .values({
          organizationId: user.organizationId,
          labelId,
          courseKey: await this.keyFor(tx, labelId, versionId),
          version: next,
          name: current.name,
          externalCode: current.externalCode,
          sourceKind: current.sourceKind,
          sourceRef: current.sourceRef,
          courseUrl: current.courseUrl,
          facts,
          priceCents: facts.price.state === 'user_confirmed' ? current.priceCents : null,
          priceNote: facts.price.state === 'user_confirmed' ? current.priceNote : null,
          dates: facts.dates.state === 'user_confirmed' ? current.dates : [],
          reviewState: 'draft',
          origin: current.origin,
          createdByUserId: user.userId,
        })
        .returning();

      const row = inserted[0];
      if (row === undefined) {
        throw new AppError('internal_error', { internalDetail: 'course confirm yielded no row' });
      }
      return toCourse(row);
    });
  }

  /**
   * Approves a course version.
   *
   * Refused while any field holds an unconfirmed value: approving a course card
   * is exactly the moment someone takes responsibility for its facts, so it
   * cannot pass with an unchecked price sitting in it.
   */
  async approve(
    db: Db,
    user: CurrentUser,
    labelId: string,
    versionId: string,
    noteNl: string | null,
  ): Promise<CourseVersion> {
    requireLabelPermission(user, labelId, 'course:approve');

    return db.transaction(async (tx) => {
      const target = await this.requireVersion(tx, labelId, versionId);
      if (target.reviewState === 'approved') {
        return target;
      }

      const outstanding = unconfirmedFacts(target);
      if (outstanding.length > 0) {
        throw new AppError('gate_not_passed', {
          publicMessage: `Deze opleidingskaart bevat informatie die nog niet is gecontroleerd (${outstanding.join(', ')}). Controleer of verwijder die velden eerst.`,
          context: { versionId, outstanding: outstanding.join(',') },
        });
      }

      const courseKey = await this.keyFor(tx, labelId, versionId);
      await tx
        .update(courseVersions)
        .set({ reviewState: 'archived' })
        .where(
          and(
            eq(courseVersions.labelId, labelId),
            eq(courseVersions.courseKey, courseKey),
            eq(courseVersions.reviewState, 'approved'),
          ),
        );

      await tx
        .update(courseVersions)
        .set({ reviewState: 'approved' })
        .where(eq(courseVersions.id, versionId));

      await this.approvals.approve(tx, user, {
        labelId,
        artefactType: 'course',
        artefactId: versionId,
        artefactVersion: target.version,
        noteNl,
      });

      return this.requireVersion(tx, labelId, versionId);
    });
  }

  private async latestForKey(
    db: DbOrTx,
    labelId: string,
    courseKey: string,
  ): Promise<CourseVersion | undefined> {
    const rows = await db
      .select()
      .from(courseVersions)
      .where(and(eq(courseVersions.labelId, labelId), eq(courseVersions.courseKey, courseKey)))
      .orderBy(desc(courseVersions.version))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toCourse(row);
  }

  private async keyFor(db: DbOrTx, labelId: string, versionId: string): Promise<string> {
    const rows = await db
      .select({ courseKey: courseVersions.courseKey })
      .from(courseVersions)
      .where(and(eq(courseVersions.id, versionId), eq(courseVersions.labelId, labelId)))
      .limit(1);
    const key = rows[0]?.courseKey;
    if (key === undefined) {
      throw AppError.notFoundOrForbidden('course', versionId);
    }
    return key;
  }
}

function slugifyCourseName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60);
  return slug.length === 0 ? 'opleiding' : slug;
}

/** Merges previous facts with incoming partials, preserving verification state. */
function buildFacts(
  previous: CourseVersion['facts'] | undefined,
  incoming: CourseInput['facts'],
  options: { confirmManual: boolean; userId: string },
): CourseVersion['facts'] {
  const now = new Date().toISOString();
  const result = {} as CourseVersion['facts'];

  for (const field of courseFactField.options) {
    const base: CourseFact = previous?.[field] ?? emptyFact;
    const patch = incoming[field];

    if (patch === undefined) {
      result[field] = base;
      continue;
    }

    const value = patch.value === undefined ? base.value : patch.value;
    const changed = value !== base.value;

    result[field] = {
      value,
      // A changed value loses its confirmation: someone must look again.
      state:
        patch.state ??
        (changed
          ? options.confirmManual && value !== null
            ? 'user_confirmed'
            : 'unverified'
          : base.state),
      sourceRef: patch.sourceRef ?? base.sourceRef,
      uncertaintyNl: patch.uncertaintyNl ?? base.uncertaintyNl,
      confirmedByUserId:
        changed && options.confirmManual && value !== null ? options.userId : base.confirmedByUserId,
      confirmedAt: changed && options.confirmManual && value !== null ? now : base.confirmedAt,
    };
  }

  return result;
}

interface CourseRow {
  id: string;
  labelId: string;
  version: number;
  name: string;
  externalCode: string | null;
  sourceKind: string;
  sourceRef: string | null;
  courseUrl: string | null;
  facts: unknown;
  priceCents: number | null;
  priceNote: string | null;
  dates: unknown;
  reviewState: string;
  origin: string;
  createdAt: Date;
  createdByUserId: string | null;
}

function toCourse(row: CourseRow): CourseVersion {
  const rawFacts = (row.facts ?? {}) as Record<string, unknown>;
  const facts = {} as CourseVersion['facts'];
  for (const field of courseFactField.options) {
    const candidate = rawFacts[field];
    facts[field] =
      candidate === undefined || candidate === null
        ? emptyFact
        : (candidate as CourseFact);
  }

  return {
    id: row.id,
    labelId: row.labelId,
    version: row.version,
    name: row.name,
    externalCode: row.externalCode,
    sourceKind: row.sourceKind as CourseVersion['sourceKind'],
    sourceRef: row.sourceRef,
    courseUrl: row.courseUrl,
    facts,
    priceCents: row.priceCents,
    priceNote: row.priceNote,
    dates: datesSchema.parse(row.dates ?? []),
    reviewState: row.reviewState as ReviewState,
    origin: row.origin as CourseVersion['origin'],
    createdAt: row.createdAt.toISOString(),
    createdByUserId: row.createdByUserId,
  };
}
