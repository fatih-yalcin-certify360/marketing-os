import { verifyKeywords } from './keywords.js';
import {
  buildDigest,
  competitorClaims,
  evidenceForPrompt,
  evidenceItems,
  redactReport,
  verifyInsights,
} from './synthesis.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyAudience, audienceBrief } from './audience.js';
import { collectAdvertisements, courseAdTerms, matchAdTerms } from './advertising.js';
import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import sharp from 'sharp';
import {
  keywordAnalysis,
  type PackageDeliverable,
  radarAnalysis,
  audienceAnalysis,
  radarDiscovery,
  radarReport,
  radarSynthesis,
  type RadarCard,
  type RadarRun,
  type RadarScanFocus,
  type CampaignObjective,
  type CurrentUser,
  EVIDENCE_STRENGTH_NL,
  FUNNEL_STAGE_LABEL_NL,
  OBJECTIVE_LABEL_NL,
  SOURCE_AGREEMENT_NL,
} from '@c360/contracts';
import type { ServerEnv } from '@c360/config';
import type { Db } from '../../core/db/types.js';
import { radarRuns, courseVersions, campaigns as campaignRows } from '../../core/db/schema.js';
import { listCompetitors } from '../competitors/service.js';
import { competitorsForCourse, competitorSource, registryContext } from './registered-competitors.js';
import { requireLabelPermission } from '../../core/authz/policy.js';
import { AppError } from '../../core/errors/app-error.js';
import {
  extractReadableText,
  inspectUrl,
  safeFetch,
  type SafeFetchOptions,
} from '../../core/net/index.js';
import type { GenerationService } from '../../core/ai/generation.js';
import type { CourseService } from '../courses/service.js';
import type { CampaignService } from '../campaigns-briefs/service.js';
import type { BrandService } from '../brand/service.js';

const normalize = (text: string): string =>
  text.replace(/[\s\u200b]+/gu, ' ').trim();
export function canonicalUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|fbclid|gclid)/u.test(key)) url.searchParams.delete(key);
  return url.toString().replace(/\/$/u, '');
}
export function pageImage(html: string, base: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/giu) ?? []) {
    if (
      !/(?:property|name)\s*=\s*["'](?:og:image|twitter:image)["']/iu.test(tag)
    )
      continue;
    const raw = /content\s*=\s*["']([^"']+)["']/iu.exec(tag)?.[1];
    if (!raw) continue;
    try {
      const url = new URL(raw.replace(/&amp;/gu, '&'), base).href;
      if (
        inspectUrl(url, { allowedHostSuffixes: [], allowInsecureHttp: false })
          .ok
      )
        return url;
    } catch {
      /* unavailable preview */
    }
  }
  return null;
}

export class MarketRadarService {
  constructor(
    private readonly generation: GenerationService,
    private readonly courses: CourseService,
    private readonly campaigns: CampaignService,
    private readonly brand: BrandService,
    private readonly env: ServerEnv,
    private readonly fetchPage: typeof safeFetch = safeFetch,
  ) {}

  get canDiscover(): boolean {
    return this.generation.supportsWebSearch;
  }
  private options(): SafeFetchOptions {
    return {
      timeoutMs: this.env.RESEARCH_FETCH_TIMEOUT_MS,
      maxResponseBytes: this.env.RESEARCH_MAX_RESPONSE_BYTES,
      maxRedirects: this.env.RESEARCH_MAX_REDIRECTS,
      allowedHostSuffixes: this.env.RESEARCH_ALLOWED_HOST_SUFFIXES,
      allowInsecureHttp: this.env.RESEARCH_ALLOW_HTTP,
    };
  }
  async list(
    db: Db,
    user: CurrentUser,
    labelId: string,
    courseId: string,
  ): Promise<RadarRun[]> {
    requireLabelPermission(user, labelId, 'research:read');
    await this.courses.requireVersion(db, labelId, courseId);
    const rows = await db
      .select()
      .from(radarRuns)
      .where(
        and(
          eq(radarRuns.labelId, labelId),
          eq(radarRuns.courseVersionId, courseId),
        ),
      )
      .orderBy(desc(radarRuns.createdAt))
      .limit(20);
    return rows.map((row) => ({
      id: row.id,
      courseVersionId: row.courseVersionId,
      createdAt: row.createdAt.toISOString(),
      report: radarReport.parse(row.report),
    }));
  }
  async requireRun(
    db: Db,
    user: CurrentUser,
    labelId: string,
    runId: string,
  ): Promise<RadarRun> {
    requireLabelPermission(user, labelId, 'research:read');
    const [row] = await db
      .select()
      .from(radarRuns)
      .where(and(eq(radarRuns.labelId, labelId), eq(radarRuns.id, runId)))
      .limit(1);
    if (!row) throw AppError.notFoundOrForbidden('radar', runId);
    return {
      id: row.id,
      courseVersionId: row.courseVersionId,
      createdAt: row.createdAt.toISOString(),
      report: radarReport.parse(row.report),
    };
  }
  async scan(
    db: Db,
    user: CurrentUser,
    input: {
      labelId: string;
      courseVersionId: string;
      urls: string[];
      discover: boolean;
      /** What to look for; `competitors` searches for nothing new. */
      focus?: RadarScanFocus | undefined;
      includeAds?: boolean;
      includeKeywords?: boolean;
      deliverables?: PackageDeliverable[];
      jobId?: string;
      attempt?: number;
      progress?: (percent: number, message: string) => Promise<void>;
    },
  ): Promise<RadarRun> {
    requireLabelPermission(user, input.labelId, 'research:run');
    if (input.deliverables?.length) throw new AppError('validation_failed', { publicMessage: 'Maak eerst een campagne en keur de briefing goed. Kies daarna het contentpakket in de campagne.' });
    const course = await this.courses.requireVersion(
      db,
      input.labelId,
      input.courseVersionId,
    );
    if (input.jobId) {
      const [prior] = await db
        .select()
        .from(radarRuns)
        .where(
          and(
            eq(radarRuns.jobId, input.jobId),
            eq(radarRuns.labelId, input.labelId),
          ),
        )
        .limit(1);
      if (prior) return this.requireRun(db, user, input.labelId, prior.id);
    }
    const previous = (
      await this.list(db, user, input.labelId, input.courseVersionId)
    )[0];
    const [courseRow] = await db.select({ key: courseVersions.courseKey }).from(courseVersions)
      .where(and(eq(courseVersions.id, course.id), eq(courseVersions.labelId, input.labelId)));
    const registry = await listCompetitors(db, input.labelId);
    const tracked = competitorsForCourse(registry, courseRow!.key);
    const trackedCompetitors = tracked.flatMap(profile => {
      const sourceUrl = competitorSource(profile);
      return sourceUrl ? [{ id: profile.id, name: profile.name, sourceUrl }] : [];
    });
    // Registered competitors must not silently fall out of the sample when discovery fills it.
    if (trackedCompetitors.length > 25) throw new AppError('validation_failed', {
      publicMessage: 'Er zijn meer dan 25 actieve concurrenten voor deze opleiding. Beperk hun opleidingsselectie of pauzeer enkele concurrenten en scan opnieuw.',
    });
    const knownOrganizations = registryContext([
      ...registry.filter(profile => profile.kind === 'own'), ...tracked,
    ]);
    const brand = await this.brand.approved(db, input.labelId);
    const common = {
      organizationId: user.organizationId,
      labelId: input.labelId,
      jobId: input.jobId ?? null,
      attempt: input.attempt ?? 0,
    };
    let urls = [...trackedCompetitors.map(profile => profile.sourceUrl), ...input.urls];
    const notes: string[] = [];
    const failures: { url: string; reason: string }[] = [];

    /*
     * What this scan goes looking for.
     *
     * `competitors` searches for nothing: it re-reads the registry, which is
     * what you want once the list of providers is settled and the question is
     * only what changed on their pages. `providers` spends the whole search on
     * organisations that teach this course; `market` is the mixed sweep.
     */
    const focus: RadarScanFocus = input.focus ?? 'market';
    const discovering = input.discover && focus !== 'competitors';
    if (focus === 'competitors') {
      notes.push(
        trackedCompetitors.length === 0
          ? 'Scan beperkt tot de opgeslagen concurrenten, en die zijn er niet voor deze opleiding. Er is niets gelezen; voeg een concurrent toe of kies een bredere scan.'
          : `Scan beperkt tot de ${String(trackedCompetitors.length)} opgeslagen concurrent(en) van deze opleiding. Er is niet naar nieuwe aanbieders gezocht, dus deze scan zegt niets over wie er nog meer is.`,
      );
    }

    if (discovering) {
      await input.progress?.(10, focus === 'providers' ? 'Aanbieders van deze opleiding zoeken' : 'Relevante marktbronnen zoeken');
      const discovered = await this.generation.generate(db, {
        ...common,
        template: 'radar.discover',
        schema: radarDiscovery,
        webSearch: true,
        context: {
          language: 'nl',
          course,
          brand: brand ?? null,
          pageText: JSON.stringify({
            observedAt: new Date().toISOString(),
            focus,
            startingUrls: urls,
            registeredOrganizations: knownOrganizations,
          }),
        },
      });
      const evidence = new Set(
        (discovered.sources ?? []).flatMap((source) => {
          try {
            return [canonicalUrl(source)];
          } catch {
            return [];
          }
        }),
      );
      const verified = discovered.value.urls.filter((url) =>
        evidence.has(canonicalUrl(url)),
      );
      if (verified.length < discovered.value.urls.length)
        notes.push(
          'Zoeklinks zonder herleidbaar zoekresultaat zijn weggelaten.',
        );
      urls.push(...verified);
      if (focus === 'providers') {
        notes.push(
          'Gericht gezocht op organisaties die deze opleiding aanbieden. Dit is een steekproef van het openbare web, geen register: een aanbieder die niet in de zoekresultaten stond, staat hier niet — dat bewijst niet dat die er niet is.',
        );
      }
    } else if (focus !== 'competitors')
      notes.push(
        'Alleen opgegeven bronnen gelezen; geen automatische ontdekking.',
      );
    const uniqueUrls = [...new Set(urls.map(canonicalUrl))];
    // A provider sweep is allowed more pages, because finding providers and
    // then reading only five of them answers the question badly.
    const pageLimit =
      focus === 'providers'
        ? Math.max(16, trackedCompetitors.length + 10)
        : Math.max(10, trackedCompetitors.length + 5);
    urls = uniqueUrls.slice(0, pageLimit);
    if (uniqueUrls.length > urls.length) notes.push(`${String(uniqueUrls.length - urls.length)} aanvullende bronlinks vallen buiten deze scan. De primaire bronnen van de opgeslagen concurrenten krijgen voorrang.`);
    if (trackedCompetitors.length) notes.push(`${String(trackedCompetitors.length)} opgeslagen concurrenten meegenomen. Per concurrent lezen we eerst de eerste opleidingslink, anders de website. Sociale links helpen bij herkenning en ontdekking; een opgeslagen profiel is geen bewijs dat alle berichten zijn gelezen.`);
    if (tracked.length > trackedCompetitors.length) notes.push('Een opgeslagen concurrent heeft nog geen bronlink of domein. Voeg een website of organisatieprofiel toe om deze te onderzoeken.');
    const pages: {
      url: string;
      text: string;
      imageUrl: string | null;
      retrievedAt: string;
      hash: string;
    }[] = [];
    for (const [index, url] of urls.entries()) {
      await input.progress?.(
        20 + Math.floor((index / Math.max(1, urls.length)) * 40),
        `Bron ${String(index + 1)} van ${String(urls.length)} lezen`,
      );
      const result = await this.fetchPage(url, this.options());
      if (!result.ok) {
        failures.push({ url, reason: result.reasonNl });
        continue;
      }
      const text = extractReadableText(result.body, 16000).text;
      if (text.length < 100) {
        failures.push({
          url,
          reason:
            'Te weinig leesbare tekst; mogelijk een interactieve of afgeschermde pagina.',
        });
        continue;
      }
      pages.push({
        url: result.finalUrl,
        text,
        imageUrl: pageImage(result.body, result.finalUrl),
        retrievedAt: result.retrievedAt.toISOString(),
        hash: createHash('sha256').update(normalize(text)).digest('hex'),
      });
    }
    const cards: RadarCard[] = [];
    if (pages.length) {
      await input.progress?.(
        70,
        'Bronnen vergelijken en creatieve kansen uitwerken',
      );
      const analyzed = await this.generation
        .generate(db, {
          ...common,
          template: 'radar.analyze',
          schema: radarAnalysis,
          context: {
            language: 'nl',
            course,
            brand: brand ?? null,
            pageText: JSON.stringify({ registeredOrganizations: knownOrganizations, pages:
              pages.map(({ url, text, retrievedAt }) => ({
                url,
                text,
                retrievedAt,
              })),
            }),
          },
        })
        .catch((error: unknown) => {
          if (
            !(error instanceof AppError) ||
            error.code !== 'provider_invalid_output'
          )
            throw error;
          return {
            value: {
              cards: [],
              note: 'De creatieve analyse leverde geen volledig bruikbaar antwoord op. Advertentieonderzoek gaat wel door; start later een nieuwe scan voor creatieve kansen.',
            },
          };
        });
      if (analyzed.value.note) notes.push(analyzed.value.note);
      const seen = new Set<string>();
      for (const proposal of analyzed.value.cards) {
        const page = pages.find(
          (p) => canonicalUrl(p.url) === canonicalUrl(proposal.sourceUrl),
        );
        if (
          !page ||
          !normalize(page.text).includes(normalize(proposal.excerpt))
        ) {
          notes.push(
            `Kaart weggelaten: geen passende bronpassage voor ${proposal.title}.`,
          );
          continue;
        }
        const dedupe = canonicalUrl(page.url) + normalize(proposal.excerpt);
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        const prior = previous?.report.cards.find(
          (card) => canonicalUrl(card.sourceUrl) === canonicalUrl(page.url),
        );
        const hasDate =
          proposal.dateExcerpt &&
          normalize(page.text).includes(normalize(proposal.dateExcerpt));
        cards.push({
          ...proposal,
          sourceUrl: page.url,
          publishedDate: hasDate ? proposal.publishedDate : null,
          dateExcerpt: hasDate ? proposal.dateExcerpt : null,
          id: randomUUID(),
          retrievedAt: page.retrievedAt,
          contentHash: page.hash,
          imageUrl: page.imageUrl,
          materialType: 'web_page',
          change: !prior
            ? 'first_seen'
            : prior.contentHash === page.hash
              ? 'unchanged'
              : 'changed',
        });
      }
    }
    if (!cards.length)
      notes.push(
        'Geen onderbouwde kansen gevonden. Bekijk de bronproblemen of voeg andere links toe en scan opnieuw.',
      );
    /*
     * A provider sweep answers one question: who else teaches this.
     *
     * So it stops after reading the pages. Audience findings, search questions,
     * advertisement libraries and the market picture all belong to the broad
     * scan; running them here would spend five calls and several minutes on
     * material nobody asked for (2026-09-16).
     */
    const providerSweep = focus === 'providers';
    if (providerSweep) {
      notes.push(
        'Gerichte aanbiederszoektocht: doelgroepbevindingen, zoekvragen, advertenties en het marktbeeld zijn overgeslagen. Draai een brede scan als je die ook wilt.',
      );
    }

    await input.progress?.(76, 'Rollen en doelgroepbewijs onderzoeken');
    const audience = !providerSweep && pages.length
      ? verifyAudience(
          (
            await this.generation
              .generate(db, {
                ...common,
                template: 'radar.audience',
                schema: audienceAnalysis,
                context: {
                  language: 'nl',
                  course,
                  brand: brand ?? null,
                  pageText: JSON.stringify({ registeredOrganizations: knownOrganizations, pages:
                    pages.map(({ url, text, retrievedAt }) => ({
                      url,
                      text,
                      retrievedAt,
                    })),
                  }),
                },
              })
              .catch((error: unknown) => {
                if (
                  !(error instanceof AppError) ||
                  error.code !== 'provider_invalid_output'
                )
                  throw error;
                return {
                  value: {
                    findings: [],
                    note: 'Doelgroepanalyse kon niet worden voltooid; advertentieonderzoek gaat door.',
                  },
                };
              })
          ).value,
          pages,
          course.sourceRef,
          registry.filter(profile => profile.kind === 'own').flatMap(profile => [
            ...profile.domains.map(domain => `https://${domain}/`),
            ...(profile.websiteUrl ? [profile.websiteUrl] : []),
          ]),
        )
      : verifyAudience(
          {
            findings: [],
            note: providerSweep
              ? 'Overgeslagen: een gerichte aanbiederszoektocht doet geen doelgroeponderzoek.'
              : 'Geen leesbare bronnen voor doelgroeponderzoek.',
          },
          pages,
          course.sourceRef,
        );
    await input.progress?.(77, 'Vragen en long-tail zoekvoorstellen onderzoeken');
    const keywords = providerSweep || input.includeKeywords === false ? null : verifyKeywords(
      pages.length ? (await this.generation.generate(db, {
        ...common, template: 'radar.keywords', schema: keywordAnalysis,
        context: { language: 'nl', course, brand: brand ?? null,
          pageText: JSON.stringify(pages.map(({ url, text, retrievedAt }) => ({ url, text, retrievedAt }))) },
      }).catch((error: unknown) => {
        if (!(error instanceof AppError) || error.code !== 'provider_invalid_output') throw error;
        return { value: null };
      })).value : null, pages);
    const advertising =
      providerSweep || input.includeAds === false
        ? null
        : await collectAdvertisements({
            courseName: course.name,
            competitorUrls: [
              ...trackedCompetitors.map(profile => profile.sourceUrl),
              ...audience.competitors.map((item) => item.sourceUrl),
              ...cards
                .filter((card) => card.relationship === 'competitor')
                .map((card) => card.sourceUrl),
            ],
            courseUrl: course.sourceRef,
            storageRoot: this.env.STORAGE_ROOT,
            enabled: this.env.AD_RESEARCH_ENABLED && !this.generation.isMock,
            executablePath: this.env.AD_RESEARCH_BROWSER_EXECUTABLE_PATH,
            onPlatform: async (platform, index) => {
              await input.progress?.(
                80 + index * 2,
                `Advertenties controleren: ${platform}`,
              );
            },
          });
    /*
     * Contact details out before anything is stored, exported or copied into
     * a brief. After the excerpt-in-page checks above, because a redacted
     * passage would no longer be found in the page; names are refused at the
     * prompt and remain a documented residual risk.
     */
    const partial = { cards, audience, keywords, advertising };
    const redactions = redactReport(partial);
    if (redactions > 0) {
      notes.push(
        `${String(redactions)} passage(s) bevatten een e-mailadres of telefoonnummer; die zijn weggelaten uit de opgeslagen tekst.`,
      );
    }

    /*
     * The market picture: what the verified items, taken together, mean.
     *
     * One more model call, over our own verified evidence rather than the raw
     * pages, and everything it returns is checked again in code: cited ids
     * must exist in this run, figures must be quoted, refused words are
     * refused. Confidence is computed from the cited domains. A model failure
     * here leaves the rest of the report intact with a note, like the other
     * extraction steps.
     */
    const items = evidenceItems(partial);
    let insights: ReturnType<typeof verifyInsights>['insights'] = [];
    if (items.length > 0 && !providerSweep) {
      await input.progress?.(90, 'Marktbeeld samenstellen');
      const synthesized = await this.generation
        .generate(db, {
          ...common,
          template: 'radar.synthesize',
          schema: radarSynthesis,
          context: {
            language: 'nl',
            course,
            brand: brand ?? null,
            pageText: JSON.stringify(evidenceForPrompt(items)),
          },
        })
        .catch((error: unknown) => {
          if (!(error instanceof AppError) || error.code !== 'provider_invalid_output') throw error;
          return { value: null };
        });
      const verified = verifyInsights(synthesized.value, items);
      insights = verified.insights;
      notes.push(...verified.notes);
    } else if (!providerSweep) {
      // Skipping on purpose is already stated once, at the top of the notes.
      notes.push('Geen marktbeeld: de scan leverde geen geverifieerde onderdelen om samen te lezen.');
    }

    const report = radarReport.parse({
      trackedCompetitors,
      advertising,
      keywords,
      package: null,
      audience,
      cards,
      notes,
      failures,
      isMock: this.generation.isMock,
      insights,
      digest: buildDigest(partial, previous),
      claims: competitorClaims(partial),
    });
    await input.progress?.(95, 'Onderbouwde kansen opslaan');
    const [row] = await db
      .insert(radarRuns)
      .values({
        organizationId: user.organizationId,
        labelId: input.labelId,
        courseVersionId: course.id,
        jobId: input.jobId ?? null,
        report,
      })
      .onConflictDoNothing()
      .returning();
    if (!row)
      throw new AppError('conflict', {
        publicMessage: 'Deze scan is al opgeslagen. Vernieuw het overzicht.',
      });
    return {
      id: row.id,
      courseVersionId: course.id,
      createdAt: row.createdAt.toISOString(),
      report,
    };
  }
  async preview(
    db: Db,
    user: CurrentUser,
    labelId: string,
    runId: string,
    cardId: string,
  ): Promise<Buffer> {
    const run = await this.requireRun(db, user, labelId, runId);
    const card = run.report.cards.find((c) => c.id === cardId);
    if (!card?.imageUrl) throw AppError.notFoundOrForbidden('preview', cardId);
    const image = await this.fetchPage(card.imageUrl, {
      ...this.options(),
      maxResponseBytes: 5_000_000,
      allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp'],
    });
    if (!image.ok || image.truncated || !image.bodyBytes)
      throw new AppError('validation_failed', {
        publicMessage: 'Geen leesbare beeldpreview beschikbaar.',
      });
    return sharp(image.bodyBytes, { limitInputPixels: 30_000_000 })
      .rotate()
      .resize({
        width: 800,
        height: 500,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 75 })
      .toBuffer();
  }
  async adPreview(
    db: Db,
    user: CurrentUser,
    labelId: string,
    runId: string,
    adId: string,
  ): Promise<Buffer> {
    const run = await this.requireRun(db, user, labelId, runId);
    if (
      !run.report.advertising?.ads.some((ad) => ad.id === adId && ad.screenshot)
    )
      throw AppError.notFoundOrForbidden('advertisement', adId);
    return readFile(
      path.join(this.env.STORAGE_ROOT, 'radar-advertisements', `${adId}.png`),
    );
  }
  private async createLinkedCampaign(db: Db, user: CurrentUser, labelId: string, runId: string, input: Parameters<CampaignService['create']>[3]) {
    const campaign = await this.campaigns.create(db, user, labelId, input);
    await db.update(campaignRows).set({ radarRunId: runId }).where(and(eq(campaignRows.id, campaign.id), eq(campaignRows.labelId, labelId)));
    return this.campaigns.requireById(db, labelId, campaign.id);
  }
  /*
   * Every hand-off from the radar carries the campaign's objective.
   *
   * A campaign created from a finding used to start with `objective: null`
   * and read "Geen doel vastgelegd" in the eight-step screen — the one
   * campaign whose reason for existing was the clearest, arriving without
   * the field that decides its funnel stages. The person chooses the
   * objective at the hand-off (the screen suggests one from the finding);
   * `null` is still accepted so older clients keep working.
   */
  async campaignFromKeyword(db: Db, user: CurrentUser, labelId: string, runId: string, keywordId: string, objective: CampaignObjective | null = null) {
    requireLabelPermission(user, labelId, 'campaign:write');
    const run = await this.requireRun(db, user, labelId, runId);
    const item = run.report.keywords?.items.find((entry) => entry.id === keywordId);
    if (!item) throw AppError.notFoundOrForbidden('keyword', keywordId);
    const course = await this.courses.requireVersion(db, labelId, run.courseVersionId);
    return this.createLinkedCampaign(db, user, labelId, run.id, {
      name: `${course.name} — ${item.phrase}`.slice(0, 200), courseVersionId: course.id,
      entryMode: 'start_from_briefing', objective, contentLanguage: 'nl', startDate: null, budgetCents: null,
      suppliedBrief: [
        `Doel: potentiële deelnemers helpen bij hun opleidingskeuze. Kanaal: LinkedIn. Creatieve aanleiding: ${item.phrase}`,
        `Bewijssoort: ${item.kind === 'page_question' ? 'letterlijke vraag op een bronpagina' : 'afgeleid zoekvoorstel, nog te toetsen hypothese'}. Geen gemeten zoekvolume of koopintentie.`,
        `Bron: ${item.sourceUrl} (bekeken ${item.retrievedAt}). Letterlijke passage: ${item.excerpt}`,
        `Interpretatie: ${item.rationale}`,
        `Herkomst: radar-run ${run.id}, vraag ${item.id}. Bepaal de contentvormen pas na het uitwerken en goedkeuren van deze campagnebrief.`,
        audienceBrief(run),
        `Gebruik uitsluitend gecontroleerde eigen opleidingsfeiten. Externe claims zijn geen feiten over onze opleiding. CTA: Bekijk de opleiding. Doel-URL: ${course.sourceRef?.startsWith('https://') ? course.sourceRef : 'Nog te bepalen.'}`,
      ].join('\n\n'),
    });
  }
  async campaignFromAudience(
    db: Db,
    user: CurrentUser,
    labelId: string,
    runId: string,
    findingId: string,
    objective: CampaignObjective | null = null,
  ) {
    requireLabelPermission(user, labelId, 'campaign:write');
    const run = await this.requireRun(db, user, labelId, runId);
    const finding = run.report.audience?.findings.find(
      (item) => item.id === findingId,
    );
    if (!finding || !run.report.audience)
      throw AppError.notFoundOrForbidden('audience_finding', findingId);
    const course = await this.courses.requireVersion(
      db,
      labelId,
      run.courseVersionId,
    );
    const snapshot = {
      ...run,
      report: {
        ...run.report,
        audience: { ...run.report.audience, findings: [finding] },
      },
    };
    const qualifiedReference = finding.sourceKind === 'alumni_story' || matchAdTerms(finding.role, courseAdTerms(course.name)).length > 0;
    const targeting = qualifiedReference
      ? `Doelgroep voor deze campagne: professionals die in deze beroepsrichting werken of ernaartoe willen, maar de aangeboden kwalificatie nog niet hebben. Dit is een afgeleide hypothese die nog onderzoek vraagt. De bronrol ${finding.role} beschrijft een beroepsreferentie met een kwalificatie; maak GEEN persona die dezelfde kwalificatie al heeft en opnieuw dezelfde opleiding zou kopen. Neem bestaande gediplomeerden niet als beoogde deelnemers op. Het verdiepingsidee in de bronanalyse is geen opdracht om deze startopleiding aan gediplomeerden te verkopen.`
      : `Gekozen doelgroepaanname: ${finding.hypothesis}. Ontwikkel persona's passend bij deze behoefte. Bestaande gediplomeerden zijn referenties, niet automatisch kandidaten voor dezelfde opleiding.`;
    return this.createLinkedCampaign(db, user, labelId, run.id, {
      name: `${course.name} — ${qualifiedReference ? 'instroom richting ' : ''}${finding.role}`.slice(0, 200),
      courseVersionId: course.id,
      entryMode: 'start_from_briefing',
      objective,
      contentLanguage: 'nl',
      startDate: null,
      budgetCents: null,
      suppliedBrief: [
        `Doel: passende kandidaten voor ${course.name} helpen bij hun opleidingskeuze. Kanaal: LinkedIn.`,
        targeting,
        audienceBrief(snapshot),
        `CTA: Bekijk de opleiding. Doel-URL: ${course.sourceRef?.startsWith('https://') ? course.sourceRef : 'Nog te bepalen.'}`,
        'Gebruik alleen gecontroleerde eigen opleidingsfeiten. Bronrollen en doelgroepinterpretaties zijn geen toelatingsvoorwaarden of bewezen koopintentie.',
      ].join('\n\n'),
    });
  }
  async campaignFromAd(
    db: Db,
    user: CurrentUser,
    labelId: string,
    runId: string,
    adId: string,
    objective: CampaignObjective | null = null,
  ) {
    requireLabelPermission(user, labelId, 'campaign:write');
    const run = await this.requireRun(db, user, labelId, runId);
    const ad = run.report.advertising?.ads.find((item) => item.id === adId);
    if (!ad) throw AppError.notFoundOrForbidden('advertisement', adId);
    const course = await this.courses.requireVersion(
      db,
      labelId,
      run.courseVersionId,
    );
    return this.createLinkedCampaign(db, user, labelId, run.id, {
      name: `${course.name} — inspiratie uit ${ad.platform}`.slice(0, 200),
      entryMode: 'start_from_briefing',
      objective,
      courseVersionId: course.id,
      contentLanguage: 'nl',
      startDate: null,
      budgetCents: null,
      suppliedBrief: [
        `Campagne voor ${course.name}. Doel: relevante bezoekers naar de eigen opleidingspagina brengen.`,
        'Creatieve richting: analyseer de invalshoek van deze referentie en ontwikkel een eigen voorstel voor onze opleiding. Neem geen tekst, beeld, aanbiedingen of opleidingsclaims van de adverteerder over.',
        `Referentie uit ${ad.platform}: ${ad.advertiser}. Bibliotheek-ID: ${ad.libraryId}.`,
        `Bron: ${ad.sourceUrl}\nBekeken: ${ad.observedAt}\nStatus bij observatie: ${ad.status}\nBrontekst (geen eigen opleidingsfeiten):\n${ad.text.slice(0, 6000)}`,
        `CTA: Bekijk de opleiding. Doel-URL: ${course.sourceRef?.startsWith('https://') ? course.sourceRef : 'Nog te bepalen.'}`,
        `Kanaal: ${ad.platform === 'meta' ? 'Facebook' : 'LinkedIn'}. Dit is een voorstel voor een organisch bericht; publiceer geen advertentie automatisch.`,
        `Herkomst: radar-run ${run.id}, advertentie ${ad.id}.`,
        audienceBrief(run),
      ].join('\n\n'),
    });
  }
  /**
   * A campaign from an insight: the hand-off the market picture exists for.
   *
   * The brief freezes the insight in its own order — what we saw, what it
   * means, the proposed action, the alternative reading and what the evidence
   * does not show — with every cited item's source URL and passage, the
   * computed confidence and the stage. The objective is the person's choice
   * at the hand-off, defaulting to what the insight suggested, so the campaign
   * lands in the eight-step screen with its funnel stages already decided.
   */
  async campaignFromInsight(
    db: Db,
    user: CurrentUser,
    labelId: string,
    runId: string,
    insightId: string,
    objective: CampaignObjective | null = null,
  ) {
    requireLabelPermission(user, labelId, 'campaign:write');
    const run = await this.requireRun(db, user, labelId, runId);
    const insight = run.report.insights.find((item) => item.id === insightId);
    if (!insight) throw AppError.notFoundOrForbidden('radar_insight', insightId);
    const course = await this.courses.requireVersion(db, labelId, run.courseVersionId);
    const items = evidenceItems(run.report);
    const cited = insight.evidence
      .map((ref) => items.find((item) => item.ref.kind === ref.kind && item.ref.id === ref.id))
      .filter((item): item is (typeof items)[number] => item !== undefined);
    const ctaUrl =
      course.sourceRef && inspectUrl(course.sourceRef, { allowedHostSuffixes: [], allowInsecureHttp: false }).ok
        ? course.sourceRef
        : null;
    const chosen = objective ?? insight.suggestedObjective;
    const suppliedBrief = [
      `Campagne voor ${course.name}. Doel: ${OBJECTIVE_LABEL_NL[chosen]}; fase uit het marktbeeld: ${FUNNEL_STAGE_LABEL_NL[insight.stage]}.`,
      `Inzicht uit Marktradar: ${insight.headlineNl}`,
      `Wat we zagen: ${insight.observationNl}`,
      `Wat het betekent: ${insight.meaningNl}`,
      `Voorgestelde actie: ${insight.nowNl}`,
      `Andere lezing van hetzelfde bewijs: ${insight.alternativeNl}`,
      `Wat dit bewijs niet laat zien: ${insight.notShownNl}`,
      `Zekerheid: ${EVIDENCE_STRENGTH_NL[insight.confidence.evidence]} ${SOURCE_AGREEMENT_NL[insight.confidence.agreement]}; ${String(insight.confidence.independentDomains)} onafhankelijk(e) domein(en).`,
      ...cited.map(
        (item) =>
          `Bewijs (${item.kindNl}, ${item.organization}): ${item.sourceUrl}${item.retrievedAt ? ` (bekeken ${item.retrievedAt})` : ''}. Letterlijke passage: ${item.excerpt}`,
      ),
      `Herkomst: radar-run ${run.id}, inzicht ${insight.id}.`,
      audienceBrief(run),
      `CTA: Bekijk de opleiding. Doel-URL: ${ctaUrl ?? 'Nog te bepalen; geen URL verzinnen.'}`,
      'Gebruik uitsluitend gecontroleerde eigen opleidingsfeiten voor cursusclaims. Uitspraken van aanbieders en bronnen zijn externe context, geen feiten of aanbiedingen van onze opleiding. Neem geen namen, aanbiedingen, testimonials of beelden van de bronnen over.',
    ]
      .filter((line) => line.length > 0)
      .join('\n\n')
      .slice(0, 20_000);
    return this.createLinkedCampaign(db, user, labelId, run.id, {
      name: `${course.name} — ${insight.headlineNl}`.slice(0, 200),
      courseVersionId: course.id,
      entryMode: 'start_from_briefing',
      objective: chosen,
      suppliedBrief,
      contentLanguage: 'nl',
      startDate: null,
      budgetCents: null,
    });
  }

  async createCampaign(
    db: Db,
    user: CurrentUser,
    labelId: string,
    runId: string,
    cardId: string,
    approachIndex: number,
    objective: CampaignObjective | null = null,
  ) {
    requireLabelPermission(user, labelId, 'campaign:write');
    const run = await this.requireRun(db, user, labelId, runId);
    const card = run.report.cards.find((c) => c.id === cardId);
    const approach = card?.approaches[approachIndex];
    if (!card || !approach)
      throw AppError.notFoundOrForbidden('radar_card', cardId);
    const course = await this.courses.requireVersion(
      db,
      labelId,
      run.courseVersionId,
    );
    const sourceRef = course.sourceRef;
    const ctaUrl =
      sourceRef &&
      inspectUrl(sourceRef, {
        allowedHostSuffixes: [],
        allowInsecureHttp: false,
      }).ok
        ? sourceRef
        : null;
    const suppliedBrief = [
      audienceBrief(run),
      `Campagne voor ${course.name}`,
      `Doel: relevante bezoekers naar de opleidingspagina brengen.`,
      `Doelgroep: ${approach.audience}`,
      `Creatieve richting: ${approach.title}\n${approach.idea}`,
      `Gewenst format: ${approach.format}. Kanaal: ${/facebook/iu.test(approach.format) ? 'Facebook' : 'LinkedIn'}.`,
      `CTA: Bekijk de opleiding. Doel-URL: ${ctaUrl ?? 'Nog te bepalen; geen URL verzinnen.'}`,
      `Aanleiding uit Marktradar (externe context, GEEN feiten of aanbiedingen van onze opleiding): ${card.observation}`,
      `Bron: ${card.sourceUrl}\nGelezen: ${card.retrievedAt}\nLetterlijke passage: ${card.excerpt}`,
      `Waarom relevant (interpretatie): ${card.relevance}\nOnzekerheden: ${card.uncertainty}`,
      `Herkomst: radar-run ${run.id}, kaart ${card.id}, aanpak ${String(approachIndex + 1)}.`,
      'Gebruik uitsluitend gecontroleerde eigen opleidingsfeiten voor cursusclaims. Neem geen namen, aanbiedingen, testimonials of beelden van de bron over. Werk de gekozen creatieve richting uit; vervang deze niet door een algemene programmaopsomming.',
    ].join('\n\n');
    return this.createLinkedCampaign(db, user, labelId, run.id, {
      name: `${course.name} — ${approach.title}`.slice(0, 200),
      courseVersionId: course.id,
      entryMode: 'start_from_briefing',
      objective,
      suppliedBrief,
      contentLanguage: 'nl',
      startDate: null,
      budgetCents: null,
    });
  }
}
