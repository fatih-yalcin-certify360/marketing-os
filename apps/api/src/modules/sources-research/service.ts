import { createHash } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  FRESHNESS_HOURS,
  createSourceInput,
  findingProposalSet,
  type CreateSourceInput,
  type CurrentUser,
  type Grounding,
  type ResearchFinding,
  type ResearchRun,
  type RunFreshness,
  type RunSourceSnapshot,
  type Source,
  type SourceKind,
  type StalenessReason,
} from '@c360/contracts';
import type { ServerEnv } from '@c360/config';
import { requireLabelPermission } from '../../core/authz/policy.js';
import { courseVersions, researchFindings, researchRuns, sources } from '../../core/db/schema.js';
import type { Db, DbOrTx } from '../../core/db/types.js';
import { AppError } from '../../core/errors/app-error.js';
import { extractReadableText, inspectUrl, safeFetch } from '../../core/net/index.js';
import type { GenerationService } from '../../core/ai/generation.js';
import type { UploadService } from '../uploads/service.js';
import type { CourseService } from '../courses/service.js';

/**
 * Sources and research runs.
 *
 * A **source** is something a label decided is worth reading. A **run** reads
 * the active sources for one course and produces **findings** — each a claim
 * with the source it came from, when that source was retrieved, and the passage
 * it rests on.
 *
 * Four rules, each one a requirement rather than a preference:
 *
 *  - **Retrieved content is data, never an instruction.** Source text travels
 *    only in the user message, inside a delimited block, and the prompt tells
 *    the model to ignore instructions found there. Nothing from a source
 *    reaches the system rules (threat T-05).
 *  - **A finding carries its provenance or it does not exist.** The reference,
 *    the retrieval date and the excerpt are all non-null in the schema.
 *  - **Nothing crosses a label.** Reads are label-scoped and so is reuse: two
 *    labels that register the same URL get separate sources, separate runs and
 *    separate findings. The composite foreign keys make the alternative
 *    unrepresentable.
 *  - **Staleness is computed, not guessed.** A run records the exact sources it
 *    read and each one's content hash, so "is this still current?" is a
 *    comparison and the reason can be named.
 *
 * ## What is deliberately absent
 *
 * There is no automatic *discovery*. Finding a page nobody named needs a search
 * engine, and there is none — so that capability reports itself absent rather
 * than being approximated. A label registers what it wants read.
 */

export class SourcesResearchService {
  constructor(
    private readonly generation: GenerationService,
    private readonly courses: CourseService,
    private readonly env: Pick<
      ServerEnv,
      | 'RESEARCH_ALLOWED_HOST_SUFFIXES'
      | 'RESEARCH_ALLOW_HTTP'
      | 'RESEARCH_FETCH_TIMEOUT_MS'
      | 'RESEARCH_MAX_RESPONSE_BYTES'
      | 'RESEARCH_MAX_REDIRECTS'
    >,
    /**
     * How a source is fetched. Defaults to the SSRF-guarded fetcher.
     *
     * Injectable so a test can reach a loopback server without a production
     * escape hatch existing anywhere: the guard stays the only fetcher this
     * module ever uses in a deployment, and the guard's own behaviour is
     * covered by its own tests rather than by opening it here.
     */
    private readonly fetchSource: typeof safeFetch = safeFetch,
    private readonly uploads?: Pick<UploadService, 'requireForDownload' | 'readDocument'>,
  ) {}

  // ------------------------------------------------------------- sources ---

  async listSources(db: DbOrTx, user: CurrentUser, labelId: string): Promise<Source[]> {
    requireLabelPermission(user, labelId, 'source:read');
    const rows = await db
      .select()
      .from(sources)
      .where(eq(sources.labelId, labelId))
      .orderBy(desc(sources.createdAt))
      .limit(200);
    return rows.map(toSource);
  }

  /**
   * Registers a source.
   *
   * A page URL is validated here with the same guard the fetcher uses, so an
   * unreachable or internal address is refused at registration rather than
   * discovered during a run. The address check still happens at fetch time,
   * because DNS can change.
   */
  async addSource(
    db: Db,
    user: CurrentUser,
    labelId: string,
    input: CreateSourceInput,
  ): Promise<Source> {
    requireLabelPermission(user, labelId, 'source:write');
    const parsed = createSourceInput.parse(input);

    if ((parsed.url === undefined) === (parsed.assetId === undefined)) {
      throw new AppError('bad_request', {
        publicMessage: 'Geef een webadres of een geüpload document op, niet beide.',
        internalDetail: 'exactly one of url / assetId is required',
      });
    }

    if ((parsed.kind === 'user_document') !== (parsed.assetId !== undefined)) {
      throw new AppError('bad_request', { publicMessage: 'Kies een document voor een documentbron en een webadres voor een paginabron.' });
    }
    if (parsed.assetId !== undefined) {
      if (!this.uploads) throw new AppError('provider_unavailable');
      const asset = await this.uploads.requireForDownload(db, user, labelId, parsed.assetId);
      if (!['application/pdf', 'text/plain', 'text/markdown', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(asset.mimeType)) {
        throw new AppError('unsupported_media_type');
      }
    }
    let url: string | null = null;
    if (parsed.url !== undefined) {
      const guard = inspectUrl(parsed.url, {
        allowedHostSuffixes: this.env.RESEARCH_ALLOWED_HOST_SUFFIXES,
        allowInsecureHttp: this.env.RESEARCH_ALLOW_HTTP,
      });
      if (!guard.ok) {
        throw new AppError('bad_request', {
          publicMessage: guard.reasonNl,
          internalDetail: `source URL refused: ${guard.finding}`,
        });
      }
      url = guard.url.toString();
    }

    const inserted = await db
      .insert(sources)
      .values({
        organizationId: user.organizationId,
        labelId,
        kind: parsed.kind,
        url,
        assetId: parsed.assetId ?? null,
        title: parsed.title,
        timeSensitivity: parsed.timeSensitivity,
        createdByUserId: user.userId,
      })
      .onConflictDoNothing()
      .returning();

    const row = inserted[0];
    if (row === undefined) {
      throw new AppError('conflict', {
        publicMessage: 'Deze bron is al vastgelegd voor dit label.',
        internalDetail: 'source already registered for this label',
      });
    }
    return toSource(row);
  }

  async setSourceActive(
    db: Db,
    user: CurrentUser,
    labelId: string,
    sourceId: string,
    isActive: boolean,
  ): Promise<Source> {
    requireLabelPermission(user, labelId, 'source:write');
    const updated = await db
      .update(sources)
      .set({ isActive, updatedAt: new Date() })
      .where(and(eq(sources.id, sourceId), eq(sources.labelId, labelId)))
      .returning();

    const row = updated[0];
    if (row === undefined) {
      // Not "forbidden": confirming the id exists in another label is the
      // enumeration channel this closes.
      throw AppError.notFoundOrForbidden('source', sourceId);
    }
    return toSource(row);
  }

  // ---------------------------------------------------------------- runs ---

  async latestRun(
    db: DbOrTx,
    labelId: string,
    courseVersionId: string,
  ): Promise<ResearchRun | undefined> {
    const rows = await db
      .select()
      .from(researchRuns)
      .where(
        and(eq(researchRuns.labelId, labelId), eq(researchRuns.courseVersionId, courseVersionId)),
      )
      .orderBy(desc(researchRuns.version))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toRun(row);
  }

  async findingsForRun(
    db: DbOrTx,
    user: CurrentUser,
    labelId: string,
    runId: string,
  ): Promise<ResearchFinding[]> {
    requireLabelPermission(user, labelId, 'research:read');
    const rows = await db
      .select()
      .from(researchFindings)
      // Both predicates: the run id alone would be enough with the composite
      // keys in place, and stating the label as well means a mistake in one
      // place cannot become a cross-label read.
      .where(and(eq(researchFindings.runId, runId), eq(researchFindings.labelId, labelId)))
      .limit(200);
    return rows.map(toFinding);
  }

  /**
   * The findings a generation step should rest on, as groundings.
   *
   * Returns the *current* run's findings only. A stale run is deliberately not
   * substituted silently: the caller decides whether to use it or re-run, which
   * is the "reuse current research, let the user force a re-run" rule.
   */
  async groundingsFor(
    db: DbOrTx,
    labelId: string,
    courseVersionId: string,
  ): Promise<{ groundings: Grounding[]; run: ResearchRun | undefined }> {
    const run = await this.latestRun(db, labelId, courseVersionId);
    // A run that is still going, or that failed, grounds nothing.
    if (run?.status !== 'completed' || !(await this.freshness(db, labelId, courseVersionId)).isCurrent) {
      return { groundings: [], run };
    }

    const rows = await db
      .select()
      .from(researchFindings)
      .where(and(eq(researchFindings.runId, run.id), eq(researchFindings.labelId, labelId)))
      .limit(200);

    return {
      groundings: rows.map((row) => ({
        claim: row.claim,
        kind: row.kind as Grounding['kind'],
        sourceRef: row.sourceRef,
        retrievedAt: row.retrievedAt.toISOString(),
      })),
      run,
    };
  }

  /**
   * Whether a run still reflects its sources.
   *
   * Named reasons rather than a boolean, because "re-run this" is a decision a
   * person makes and "the price page changed" is a very different prompt from
   * "nothing has changed but it is three months old".
   */
  async freshness(
    db: DbOrTx,
    labelId: string,
    courseVersionId: string,
    now = new Date(),
  ): Promise<RunFreshness> {
    const run = await this.latestRun(db, labelId, courseVersionId);
    if (run === undefined) {
      return { isCurrent: false, reasons: [] };
    }

    const live = await db
      .select()
      .from(sources)
      .where(and(eq(sources.labelId, labelId), eq(sources.isActive, true)))
      .limit(200);

    const reasons: { reason: StalenessReason; detailNl: string }[] = [];
    const snapshot = new Map(run.sources.map((entry) => [entry.sourceId, entry]));

    for (const row of live) {
      const seen = snapshot.get(row.id);
      if (seen === undefined) {
        reasons.push({
          reason: 'source_added',
          detailNl: `Nieuwe bron toegevoegd: ${row.title}.`,
        });
        continue;
      }
      if (row.contentSha256 !== null && seen.contentSha256 !== row.contentSha256) {
        reasons.push({
          reason: 'source_content_changed',
          detailNl: `De inhoud van "${row.title}" is gewijzigd sinds het onderzoek.`,
        });
        continue;
      }
      const retrieved = seen.retrievedAt === null ? null : new Date(seen.retrievedAt);
      const limitMs = FRESHNESS_HOURS[normaliseSensitivity(row.timeSensitivity)] * 3_600_000;
      if (seen.failureNl !== null || row.lastFailureNl !== null || retrieved === null || now.getTime() - retrieved.getTime() > limitMs) {
        reasons.push({
          reason: 'source_too_old',
          detailNl: `"${row.title}" is langer dan de houdbaarheid van deze bron niet gelezen.`,
        });
      }
    }

    const liveIds = new Set(live.map((row) => row.id));
    for (const entry of run.sources) {
      if (!liveIds.has(entry.sourceId)) {
        reasons.push({
          reason: 'source_removed',
          detailNl: 'Een bron die in het onderzoek zat, is niet meer actief.',
        });
      }
    }

    return { isCurrent: reasons.length === 0 && run.status === 'completed', reasons };
  }

  /**
   * Reads the active sources and records findings.
   *
   * Runs on the worker: it fetches every source and then makes a model call, so
   * a request must not hold it open (ADR-0016).
   */
  async run(
    db: Db,
    user: CurrentUser,
    input: {
      labelId: string;
      courseVersionId: string;
      jobId?: string | null;
      attempt?: number;
      signal?: AbortSignal | undefined;
      onProgress?: ((percent: number, messageNl: string) => Promise<void>) | undefined;
    },
  ): Promise<{
    run: ResearchRun;
    findings: ResearchFinding[];
    isMock: boolean;
    readCount: number;
    failedCount: number;
  }> {
    requireLabelPermission(user, input.labelId, 'research:run');
    const course = await this.courses.requireVersion(db, input.labelId, input.courseVersionId);

    const active = await db
      .select()
      .from(sources)
      .where(and(eq(sources.labelId, input.labelId), eq(sources.isActive, true)))
      .limit(201);

    if (active.length === 0) {
      throw new AppError('gate_not_passed', {
        publicMessage:
          'Er zijn nog geen actieve bronnen voor dit label. Leg eerst een bron vast onder Merk & bronnen.',
        internalDetail: 'no active sources for label',
      });
    }

    if (active.length > 200) throw new AppError('gate_not_passed', { publicMessage: 'Gebruik maximaal 200 actieve bronnen per label.' });
    const startedAt = new Date();
    await input.onProgress?.(5, `${String(active.length)} bronnen worden gelezen`);

    const pending = await db.transaction(async (tx) => {
      // Serialize version allocation per course, without holding a lock during I/O.
      await tx.select({ id: courseVersions.id }).from(courseVersions)
        .where(eq(courseVersions.id, input.courseVersionId)).for('update');
      const previous = await tx
        .select({ version: researchRuns.version })
        .from(researchRuns)
        .where(
          and(
            eq(researchRuns.labelId, input.labelId),
            eq(researchRuns.courseVersionId, input.courseVersionId),
          ),
        )
        .orderBy(desc(researchRuns.version))
        .limit(1);

      const version = (previous[0]?.version ?? 0) + 1;
      const insertedRun = await tx
        .insert(researchRuns)
        .values({
          organizationId: user.organizationId,
          labelId: input.labelId,
          courseVersionId: input.courseVersionId,
          version,
          status: 'running',
          sourcesSnapshot: [],
          findingCount: 0,
          startedAt,
          createdByUserId: user.userId,
        })
        .returning();

      const runRow = insertedRun[0];
      if (runRow === undefined) {
        throw new AppError('internal_error', { internalDetail: 'research run was not written' });
      }

      return runRow;
    });
    const snapshot: RunSourceSnapshot[] = [];
    try {
      const readable: { sourceId: string; ref: string; retrievedAt: Date; text: string }[] = [];
      let index = 0;

      for (const row of active) {
        index += 1;
        const percent = 5 + Math.round((index / active.length) * 45);

        input.signal?.throwIfAborted();
        let text: string;
        let ref: string;
        let retrievedAt: Date;
        try {
          if (row.url === null) {
            if (!row.assetId || !this.uploads) throw new AppError('provider_unavailable', { publicMessage: 'Dit document kan niet worden gelezen.' });
            const document = await this.uploads.readDocument(db, user, input.labelId, row.assetId);
            text = document.text;
            ref = document.ref;
            retrievedAt = new Date();
          } else {
            const fetched = await this.fetchSource(row.url, {
              allowedHostSuffixes: this.env.RESEARCH_ALLOWED_HOST_SUFFIXES,
              allowInsecureHttp: this.env.RESEARCH_ALLOW_HTTP,
              timeoutMs: this.env.RESEARCH_FETCH_TIMEOUT_MS,
              maxResponseBytes: this.env.RESEARCH_MAX_RESPONSE_BYTES,
              maxRedirects: this.env.RESEARCH_MAX_REDIRECTS,
            });
            if (!fetched.ok) throw new AppError('provider_unavailable', { publicMessage: fetched.reasonNl });
            text = extractReadableText(fetched.body).text;
            ref = fetched.finalUrl;
            retrievedAt = fetched.retrievedAt;
          }
          input.signal?.throwIfAborted();
          if (!text.trim()) throw new AppError('validation_failed');
        } catch (error) {
          input.signal?.throwIfAborted();
          const reason = error instanceof AppError ? error.publicMessage : 'Deze bron kon niet worden gelezen.';
          snapshot.push({ sourceId: row.id, contentSha256: row.contentSha256,
            retrievedAt: row.lastRetrievedAt?.toISOString() ?? null, failureNl: reason });
          await this.recordSourceFailure(db, row.id, reason);
          await input.onProgress?.(percent, `${row.title}: niet gelezen`);
          continue;
        }
        const hash = createHash('sha256').update(text, 'utf8').digest('hex');

        await db
          .update(sources)
          .set({
            contentSha256: hash,
            lastRetrievedAt: retrievedAt,
            lastFailureNl: null,
            updatedAt: new Date(),
          })
          .where(eq(sources.id, row.id));

        snapshot.push({
          sourceId: row.id,
          contentSha256: hash,
          retrievedAt: retrievedAt.toISOString(),
          failureNl: null,
        });
        readable.push({
          sourceId: row.id,
          ref,
          retrievedAt: retrievedAt,
          text,
        });
        await input.onProgress?.(percent, `${row.title}: gelezen`);
      }

      if (readable.length === 0) {
        throw new AppError('provider_unavailable', {
          publicMessage:
            'Geen van de bronnen kon worden gelezen. Controleer de webadressen en probeer het opnieuw.',
          internalDetail: `all ${String(active.length)} sources failed`,
        });
      }

      const perSourceLimit = Math.floor(60_000 / readable.length);
      for (const entry of readable) entry.text = entry.text.slice(0, perSourceLimit);
      await input.onProgress?.(60, 'De bronnen worden geanalyseerd');

      const result = await this.generation.generate(db, {
        template: 'research.findings',
        schema: findingProposalSet,
        organizationId: user.organizationId,
        labelId: input.labelId,
        jobId: input.jobId ?? null,
        attempt: input.attempt ?? 0,
        signal: input.signal,
        context: {
          language: 'nl',
          course,
          brand: null,
          // Delimited, and last. The template instructs the model to treat this
          // as given rather than as an instruction (threat T-05).
          pageText: readable
            .map((entry, position) => `[bron ${String(position + 1)}: ${entry.ref}]\n${entry.text}`)
            .join('\n\n'),
        },
      });

      const normalise = (value: string): string => value.replace(/\s+/gu, ' ').trim();
      const verified = result.value.findings.flatMap((finding) => {
        const excerpt = normalise(finding.excerpt);
        const owners = readable.filter((entry) => excerpt.length > 0 && normalise(entry.text).includes(excerpt));
        return owners.length === 1 ? [{ finding, owner: owners[0]! }] : [];
      });
      const shortfallReasonNl = verified.length < result.value.findings.length
        ? 'Bevindingen zonder een eenduidig teruggevonden bronpassage zijn weggelaten.'
        : result.value.shortfallReasonNl;
      await input.onProgress?.(85, 'Bevindingen worden vastgelegd');

      return await db.transaction(async (tx) => {
        const [runRow] = await tx.update(researchRuns).set({
          status: 'completed', sourcesSnapshot: snapshot, findingCount: verified.length,
          shortfallReasonNl, promptVersion: result.promptVersion, finishedAt: new Date(),
        }).where(eq(researchRuns.id, pending.id)).returning();
        if (!runRow) throw new AppError('internal_error');

        // Keep only complete excerpts that match exactly one source.
        const findingRows = verified.map(({ finding, owner }) => {
          return {
            organizationId: user.organizationId,
            labelId: input.labelId,
            runId: runRow.id,
            sourceId: owner.sourceId,
            claim: finding.claim,
            kind: owner.ref.startsWith('document:') ? 'user_document' as const : 'external_source' as const,
            sourceRef: owner.ref,
            retrievedAt: owner.retrievedAt,
            excerpt: finding.excerpt,
            uncertaintyNl: finding.uncertaintyNl,
          };
        });

        const insertedFindings =
          findingRows.length === 0 ? [] : await tx.insert(researchFindings).values(findingRows).returning();

        return {
          run: toRun(runRow),
          findings: insertedFindings.map(toFinding),
          isMock: result.isMock,
          readCount: readable.length,
          failedCount: active.length - readable.length,
        };
      });
    } catch (error) {
      await db.update(researchRuns).set({ status: 'failed', sourcesSnapshot: snapshot,
        failureNl: error instanceof AppError ? error.publicMessage : 'Het onderzoek is gestopt. Probeer het opnieuw.',
        finishedAt: new Date(),
      }).where(eq(researchRuns.id, pending.id));
      throw error;
    }
  }


  private async recordSourceFailure(db: Db, sourceId: string, reasonNl: string): Promise<void> {
    await db
      .update(sources)
      .set({ lastFailureNl: reasonNl, updatedAt: new Date() })
      .where(eq(sources.id, sourceId));
  }

  /** Deletes findings for runs of a course version. Used by tests and cleanup. */
  async deleteRunsForCourse(db: Db, labelId: string, courseVersionId: string): Promise<number> {
    const runs = await db
      .select({ id: researchRuns.id })
      .from(researchRuns)
      .where(
        and(eq(researchRuns.labelId, labelId), eq(researchRuns.courseVersionId, courseVersionId)),
      );
    if (runs.length === 0) {
      return 0;
    }
    await db.delete(researchRuns).where(
      inArray(
        researchRuns.id,
        runs.map((row) => row.id),
      ),
    );
    return runs.length;
  }
}

function normaliseSensitivity(value: string): 'high' | 'medium' | 'low' {
  return value === 'high' || value === 'low' ? value : 'medium';
}

function toSource(row: typeof sources.$inferSelect): Source {
  return {
    id: row.id,
    labelId: row.labelId,
    kind: row.kind as SourceKind,
    url: row.url,
    assetId: row.assetId,
    title: row.title,
    timeSensitivity: normaliseSensitivity(row.timeSensitivity),
    contentSha256: row.contentSha256,
    lastRetrievedAt: row.lastRetrievedAt?.toISOString() ?? null,
    lastFailureNl: row.lastFailureNl,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

function toRun(row: typeof researchRuns.$inferSelect): ResearchRun {
  return {
    id: row.id,
    labelId: row.labelId,
    courseVersionId: row.courseVersionId,
    version: row.version,
    status: row.status as ResearchRun['status'],
    sources: (row.sourcesSnapshot ?? []) as RunSourceSnapshot[],
    findingCount: row.findingCount,
    shortfallReasonNl: row.shortfallReasonNl,
    promptVersion: row.promptVersion,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    failureNl: row.failureNl,
  };
}

function toFinding(row: typeof researchFindings.$inferSelect): ResearchFinding {
  return {
    id: row.id,
    runId: row.runId,
    sourceId: row.sourceId,
    claim: row.claim,
    kind: row.kind as ResearchFinding['kind'],
    sourceRef: row.sourceRef,
    retrievedAt: row.retrievedAt.toISOString(),
    excerpt: row.excerpt,
    uncertaintyNl: row.uncertaintyNl,
  };
}
