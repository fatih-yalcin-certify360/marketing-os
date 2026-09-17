import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import type {
  BrandProfileInput,
  BrandProfileVersion,
  BriefVersion,
  Campaign,
  CampaignListItem,
  CampaignObjective,
  CampaignCalendar,
  ConceptVersion,
  ContentAssetVersion,
  StandaloneContentInput,
  ContentPlan,
  CourseFactField,
  CourseVersion,
  ExportRecord,
  Learning,
  LearningInputData,
  LearningWithEvidence,
  Opportunity,
  OutcomeInputData,
  OutcomeReport,
  PersonaListScope,
  PersonaVersion,
  PublicationInput,
  PublicationRecord,
  ReviewState,
  WorkflowGate,
} from '@c360/contracts';
import type { JobSummary } from '@c360/contracts';
import type { ApiClientError } from './client.js';
import { api } from './client.js';
import { queryKeys } from './queries.js';

/**
 * Server state for the campaign chain.
 *
 * Query keys are label- and campaign-scoped, so switching label or campaign
 * cannot show the previous one's cached data. Mutations invalidate the campaign
 * key, which is deliberately coarse: every stage transition changes what the
 * gates evaluate to, so refetching the assembled view is both simpler and more
 * correct than patching pieces of it.
 */

export const campaignKeys = {
  brand: (labelId: string) => ['brand', labelId] as const,
  courses: (labelId: string) => ['courses', labelId] as const,
  personas: (labelId: string, courseVersionId: string) =>
    ['personas', labelId, courseVersionId] as const,
  campaigns: (labelId: string) => ['campaigns', labelId] as const,
  campaign: (labelId: string, campaignId: string) => ['campaign', labelId, campaignId] as const,
  opportunitySet: (labelId: string, setId: string) => ['opportunities', labelId, setId] as const,
  contentVersions: (labelId: string, campaignId: string, assetKey: string) =>
    ['content-versions', labelId, campaignId, assetKey] as const,
  standaloneContent: (labelId: string) => ['standalone-content', labelId] as const,
};

function retryPolicy(failureCount: number, error: ApiClientError): boolean {
  if (error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 2;
}

// ------------------------------------------------------------------ brand ---

export interface BrandState {
  portal?: { configured: boolean; slug: string | null; checkedAt: string | null; error: string | null };
  approved: BrandProfileVersion | null;
  latest: BrandProfileVersion | null;
  startingPoint: BrandProfileInput;
}

export function useBrand(labelId: string | undefined): UseQueryResult<BrandState, ApiClientError> {
  return useQuery<BrandState, ApiClientError>({
    queryKey: campaignKeys.brand(labelId ?? 'none'),
    queryFn: ({ signal }) => api.get<BrandState>(`/labels/${String(labelId)}/brand`, signal),
    enabled: labelId !== undefined,
    retry: retryPolicy,
  });
}

export function useSaveBrand(
  labelId: string,
): UseMutationResult<BrandProfileVersion, ApiClientError, BrandProfileInput> {
  const client = useQueryClient();
  return useMutation<BrandProfileVersion, ApiClientError, BrandProfileInput>({
    mutationFn: (input) => api.post<BrandProfileVersion>(`/labels/${labelId}/brand`, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: campaignKeys.brand(labelId) });
    },
  });
}

export function useApproveBrand(
  labelId: string,
): UseMutationResult<BrandProfileVersion, ApiClientError, { versionId: string }> {
  const client = useQueryClient();
  return useMutation<BrandProfileVersion, ApiClientError, { versionId: string }>({
    mutationFn: ({ versionId }) =>
      api.post<BrandProfileVersion>(`/labels/${labelId}/brand/${versionId}/approve`, {}),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: campaignKeys.brand(labelId) });
      void client.invalidateQueries({ queryKey: ['workspace'] });
    },
  });
}

// ---------------------------------------------------------------- courses ---

export interface CourseListItem {
  course: CourseVersion;
  confirmed: string[];
  unconfirmed: string[];
}

export interface CourseList {
  items: CourseListItem[];
  factLabels: Record<CourseFactField, string>;
}

export function useCourses(labelId: string | undefined): UseQueryResult<CourseList, ApiClientError> {
  return useQuery<CourseList, ApiClientError>({
    queryKey: campaignKeys.courses(labelId ?? 'none'),
    queryFn: ({ signal }) => api.get<CourseList>(`/labels/${String(labelId)}/courses`, signal),
    enabled: labelId !== undefined,
    retry: retryPolicy,
  });
}

/**
 * Every piece this label made outside a campaign.
 *
 * A separate list, not a filter on the campaign content: the campaign list
 * starts by requiring a campaign, and a loose piece has none (2026-09-15).
 */
export function useStandaloneContent(
  labelId: string | undefined,
): UseQueryResult<{ items: ContentAssetVersion[] }, ApiClientError> {
  return useQuery<{ items: ContentAssetVersion[] }, ApiClientError>({
    queryKey: campaignKeys.standaloneContent(labelId ?? 'none'),
    queryFn: ({ signal }) =>
      api.get<{ items: ContentAssetVersion[] }>(`/labels/${String(labelId)}/content/standalone`, signal),
    enabled: labelId !== undefined,
    retry: retryPolicy,
  });
}

/**
 * Withdraws a piece from its campaign.
 *
 * Nothing is deleted: every version is archived, so approvals and earlier
 * exports keep pointing at something real. It exists because three producible
 * channels can never reach a publish-ready export, and one such piece blocked
 * every publish-ready export of that campaign for good (2026-09-15).
 */
export function useWithdrawContent(
  labelId: string,
  campaignId: string,
): UseMutationResult<{ assetKey: string; archivedVersions: number }, ApiClientError, { assetId: string }> {
  const client = useQueryClient();
  return useMutation<{ assetKey: string; archivedVersions: number }, ApiClientError, { assetId: string }>({
    mutationFn: ({ assetId }) =>
      api.remove(`/labels/${labelId}/campaigns/${campaignId}/content/${assetId}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: campaignKeys.campaign(labelId, campaignId) });
      void client.invalidateQueries({ queryKey: ['workspace'] });
    },
  });
}

/** Gives a loose piece a campaign, after the fact. */
export function useAttachToCampaign(
  labelId: string,
): UseMutationResult<ContentAssetVersion, ApiClientError, { assetId: string; campaignId: string }> {
  const client = useQueryClient();
  return useMutation<ContentAssetVersion, ApiClientError, { assetId: string; campaignId: string }>({
    mutationFn: ({ assetId, campaignId }) =>
      api.post(`/labels/${labelId}/content/${assetId}/campaign`, { campaignId }),
    onSuccess: (asset) => {
      void client.invalidateQueries({ queryKey: campaignKeys.standaloneContent(labelId) });
      if (asset.campaignId !== null) {
        void client.invalidateQueries({ queryKey: campaignKeys.campaign(labelId, asset.campaignId) });
      }
    },
  });
}

/** Asks for one piece of content outside any campaign. */
/**
 * Asks for one piece outside a campaign, and gets a job back.
 *
 * The work moved onto the queue because writing a piece — and for an image
 * channel rendering two variants of it — is minutes, not seconds, and nobody
 * should have to sit in front of that. The caller shows the confirmation and
 * closes; the shell's background-work watcher says when it has landed
 * (2026-09-15).
 */
export function useCreateStandaloneContent(
  labelId: string,
): UseMutationResult<JobSummary, ApiClientError, StandaloneContentInput> {
  const client = useQueryClient();
  return useMutation<JobSummary, ApiClientError, StandaloneContentInput>({
    mutationFn: (input) => api.post(`/labels/${labelId}/content/standalone`, input),
    onSuccess: () => {
      // The list is invalidated now so the job appears in the background-task
      // panel immediately; the piece itself arrives when the job finishes.
      void client.invalidateQueries({ queryKey: queryKeys.jobs(labelId) });
    },
  });
}

export function useConfirmFacts(
  labelId: string,
): UseMutationResult<
  CourseVersion,
  ApiClientError,
  { versionId: string; fields: CourseFactField[] }
> {
  const client = useQueryClient();
  return useMutation<CourseVersion, ApiClientError, { versionId: string; fields: CourseFactField[] }>({
    mutationFn: ({ versionId, fields }) =>
      api.post<CourseVersion>(`/labels/${labelId}/courses/${versionId}/confirm`, { fields }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: campaignKeys.courses(labelId) });
      void client.invalidateQueries({ queryKey: ['workspace'] });
    },
  });
}

export function useApproveCourse(
  labelId: string,
): UseMutationResult<CourseVersion, ApiClientError, { versionId: string }> {
  const client = useQueryClient();
  return useMutation<CourseVersion, ApiClientError, { versionId: string }>({
    mutationFn: ({ versionId }) =>
      api.post<CourseVersion>(`/labels/${labelId}/courses/${versionId}/approve`, {}),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: campaignKeys.courses(labelId) });
      void client.invalidateQueries({ queryKey: ['workspace'] });
    },
  });
}

/**
 * Reads a course page and proposes a card from it.
 *
 * Returns a **job**, like every step that costs a model call: the fetch plus
 * the extraction is well past what a request should hold open, so the request
 * writes a job row and the screen follows it.
 *
 * A repeated submission of the same URL collapses onto the same job — the
 * server derives the idempotency key from the URL — so the answer may be an
 * already-running job rather than a new one. There is nothing to distinguish
 * for the user: either way the thing to do is watch it.
 *
 * Every field the extractor proposes arrives `unverified` with the page as its
 * source. Nothing is published from an unverified field, and a person still
 * confirms each fact on this screen. That is the point of routing a page
 * through here rather than trusting it.
 */
export function useExtractCourseFromUrl(
  labelId: string,
): UseMutationResult<JobSummary, ApiClientError, { url: string; courseKey?: string }> {
  const client = useQueryClient();
  return useMutation<JobSummary, ApiClientError, { url: string; courseKey?: string }>({
    mutationFn: (input) =>
      api.post<JobSummary>(`/labels/${labelId}/courses/extract-from-url`, input),
    onSuccess: () => {
      // The card appears when the job finishes, which `JobWatcher` handles.
      // This refresh is for the job list itself.
      void client.invalidateQueries({ queryKey: ['jobs', labelId] });
    },
  });
}

/**
 * Reads an uploaded document and proposes a course card from it.
 *
 * Two calls, in one mutation, because the second needs the first's asset id:
 * the file is uploaded and validated, and only then is the extraction queued.
 * The order matters — a file that fails validation must never reach a job, so
 * an upload refusal (wrong type, too large, an SVG carrying script) surfaces
 * here as the mutation's error and nothing is queued.
 *
 * Like the URL path, the result is a job and every proposed field arrives
 * `unverified` with the document's filename as its source.
 */
export function useExtractCourseFromDocument(
  labelId: string,
): UseMutationResult<JobSummary, ApiClientError, File> {
  const client = useQueryClient();
  return useMutation<JobSummary, ApiClientError, File>({
    mutationFn: async (file) => {
      const asset = await api.upload<{ id: string }>(
        `/labels/${labelId}/uploads/course_document`,
        file,
      );
      return api.post<JobSummary>(`/labels/${labelId}/courses/extract-from-document`, {
        assetId: asset.id,
      });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['jobs', labelId] });
    },
  });
}

/**
 * Chooses or clears the campaign's start date.
 *
 * The calendar is derived from it server-side, so there is nothing else to
 * send and nothing to keep in step: invalidating the campaign is what makes the
 * new dates appear.
 */
export function useSetStartDate(
  labelId: string,
  campaignId: string,
): UseMutationResult<Campaign, ApiClientError, string | null> {
  const client = useQueryClient();
  return useMutation<Campaign, ApiClientError, string | null>({
    mutationFn: (startDate) =>
      api.patch<Campaign>(`/labels/${labelId}/campaigns/${campaignId}/start-date`, { startDate }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: campaignKeys.campaign(labelId, campaignId) });
    },
  });
}

// --------------------------------------------------------------- personas ---

/**
 * Proposing personas returns a **job**, not personas.
 *
 * Generation happens on the worker, so the request completes in milliseconds
 * and the client follows the job. The produced personas appear through the
 * normal list query once the job invalidates it.
 */

/**
 * `scope` follows the route's default when omitted: a campaign id lists that
 * campaign's personas, none lists the library. `all` is for the screens that
 * show every persona of the course with where it came from.
 */
export function usePersonas(
  labelId: string | undefined,
  courseVersionId: string | undefined,
  campaignId?: string,
  scope?: PersonaListScope,
): UseQueryResult<{ items: PersonaVersion[] }, ApiClientError> {
  const query = new URLSearchParams();
  if (campaignId !== undefined) query.set('campaignId', campaignId);
  if (scope !== undefined) query.set('scope', scope);
  const search = query.size === 0 ? '' : `?${query.toString()}`;
  return useQuery<{ items: PersonaVersion[] }, ApiClientError>({
    queryKey: [
      ...campaignKeys.personas(labelId ?? 'none', courseVersionId ?? 'none'),
      campaignId ?? 'course',
      scope ?? 'default',
    ],
    queryFn: ({ signal }) =>
      api.get<{ items: PersonaVersion[] }>(
        `/labels/${String(labelId)}/courses/${String(courseVersionId)}/personas${search}`,
        signal,
      ),
    enabled: labelId !== undefined && courseVersionId !== undefined,
    retry: retryPolicy,
  });
}

/**
 * Copies a campaign persona into the library. The result is the new library
 * version; every persona list of the label is refetched so both screens show
 * it without a reload.
 */
export function usePromotePersona(
  labelId: string,
): UseMutationResult<PersonaVersion, ApiClientError, { personaVersionId: string }> {
  const client = useQueryClient();
  return useMutation<PersonaVersion, ApiClientError, { personaVersionId: string }>({
    mutationFn: ({ personaVersionId }) =>
      api.post<PersonaVersion>(`/labels/${labelId}/personas/${personaVersionId}/library`, {}),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['personas', labelId] });
    },
  });
}

/**
 * Lets the system answer the open questions of a stored persona's
 * questionnaire. The result is a job; when it finishes, the persona lists are
 * refetched by the job poller and the new version appears in place.
 */
export function useFillPersonaQuestionnaire(
  labelId: string,
): UseMutationResult<JobSummary, ApiClientError, { personaVersionId: string }> {
  return useMutation<JobSummary, ApiClientError, { personaVersionId: string }>({
    mutationFn: ({ personaVersionId }) =>
      api.post<JobSummary>(`/labels/${labelId}/personas/${personaVersionId}/questionnaire/fill`, {}),
  });
}

/**
 * Researches where one stored audience orients.
 *
 * Separate from the questionnaire fill because it answers a different question
 * and a persona can need one without the other: a hand-written persona often
 * has all 36 answers and no orientation at all.
 */
export function useFillPersonaOrientation(
  labelId: string,
): UseMutationResult<JobSummary, ApiClientError, { personaVersionId: string }> {
  return useMutation<JobSummary, ApiClientError, { personaVersionId: string }>({
    mutationFn: ({ personaVersionId }) =>
      api.post<JobSummary>(`/labels/${labelId}/personas/${personaVersionId}/orientation/fill`, {}),
  });
}

export function useProposePersonas(
  labelId: string,
): UseMutationResult<JobSummary, ApiClientError, { courseVersionId: string; campaignId?: string }> {
  return useMutation<JobSummary, ApiClientError, { courseVersionId: string; campaignId?: string }>({
    mutationFn: ({ courseVersionId, campaignId }) =>
      api.post<JobSummary>(`/labels/${labelId}/courses/${courseVersionId}/personas/propose`, { campaignId }),
  });
}

// ---------------------------------------------------------- opportunities ---

export function useProposeOpportunities(
  labelId: string,
): UseMutationResult<
  JobSummary,
  ApiClientError,
  { courseVersionId: string; personaVersionIds: string[] }
> {
  return useMutation<
    JobSummary,
    ApiClientError,
    { courseVersionId: string; personaVersionIds: string[] }
  >({
    mutationFn: (input) => api.post<JobSummary>(`/labels/${labelId}/opportunities/propose`, input),
  });
}

/** Opportunities produced by a finished proposal job. */
export function useOpportunitySet(
  labelId: string,
  setId: string | undefined,
): UseQueryResult<{ items: Opportunity[] }, ApiClientError> {
  return useQuery<{ items: Opportunity[] }, ApiClientError>({
    queryKey: campaignKeys.opportunitySet(labelId, setId ?? 'none'),
    queryFn: ({ signal }) =>
      api.get<{ items: Opportunity[] }>(
        `/labels/${labelId}/opportunities/${String(setId)}`,
        signal,
      ),
    enabled: setId !== undefined,
    retry: retryPolicy,
  });
}

// -------------------------------------------------------------- campaigns ---

export interface CampaignDetail {
  campaign: Campaign;
  brief: BriefVersion | null;
  briefApproved: boolean;
  personas: PersonaVersion[];
  concepts: ConceptVersion[];
  selectedConcept: ConceptVersion | null;
  plan: { id: string; version: number; plan: ContentPlan; reviewState: ReviewState } | null;
  /** Derived server-side from the plan, the start date and confirmed course dates. */
  calendar: CampaignCalendar;
  assets: ContentAssetVersion[];
  exports: ExportRecord[];
  gates: {
    passed: WorkflowGate[];
    blockedReasonsNl: string[];
    labels: Record<WorkflowGate, string>;
  };
  /** Whether any result has been recorded for this campaign; see step 8. */
  hasOutcomes: boolean;
  aiIsMock: boolean;
  aiProvider: string;
}

/**
 * The label's campaigns with where each stands (`progress`, computed by the
 * server with the same rule the detail page uses). One page of up to a
 * hundred: a label with more than that gets a "Meer laden" from `nextCursor`.
 */
export function useCampaigns(
  labelId: string | undefined,
): UseQueryResult<{ items: CampaignListItem[]; nextCursor: string | null }, ApiClientError> {
  return useQuery<{ items: CampaignListItem[]; nextCursor: string | null }, ApiClientError>({
    queryKey: campaignKeys.campaigns(labelId ?? 'none'),
    queryFn: ({ signal }) =>
      api.get<{ items: CampaignListItem[]; nextCursor: string | null }>(
        `/labels/${String(labelId)}/campaigns?limit=100`,
        signal,
      ),
    enabled: labelId !== undefined,
    retry: retryPolicy,
  });
}

export function useCampaign(
  labelId: string | undefined,
  campaignId: string | undefined,
): UseQueryResult<CampaignDetail, ApiClientError> {
  return useQuery<CampaignDetail, ApiClientError>({
    queryKey: campaignKeys.campaign(labelId ?? 'none', campaignId ?? 'none'),
    queryFn: ({ signal }) =>
      api.get<CampaignDetail>(
        `/labels/${String(labelId)}/campaigns/${String(campaignId)}`,
        signal,
      ),
    enabled: labelId !== undefined && campaignId !== undefined,
    retry: retryPolicy,
  });
}

export function useCreateCampaign(
  labelId: string,
): UseMutationResult<
  Campaign,
  ApiClientError,
  { name: string; entryMode: Campaign['entryMode']; objective: CampaignObjective | null; courseVersionId: string; userIdea?: string; suppliedBrief?: string }
> {
  const client = useQueryClient();
  return useMutation<
    Campaign,
    ApiClientError,
    { name: string; entryMode: Campaign['entryMode']; objective: CampaignObjective | null; courseVersionId: string; userIdea?: string; suppliedBrief?: string }
  >({
    mutationFn: (input) => api.post<Campaign>(`/labels/${labelId}/campaigns`, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: campaignKeys.campaigns(labelId) });
    },
  });
}

/**
 * One mutation factory for every stage action.
 *
 * They all invalidate the same assembled campaign view, because a stage
 * transition changes the gate evaluation — refetching the server's answer is
 * more reliable than trying to predict it in the browser.
 */
export function useCampaignAction<TResult, TInput = void>(
  labelId: string,
  /** Null for a standalone piece, whose list is refreshed instead. */
  campaignId: string | null,
  buildRequest: (input: TInput) => { path: string; body?: unknown; method?: 'PATCH' | 'POST' },
): UseMutationResult<TResult, ApiClientError, TInput> {
  const client = useQueryClient();
  return useMutation<TResult, ApiClientError, TInput>({
    mutationFn: (input) => {
      const { path, body, method } = buildRequest(input);
      return method === 'PATCH' ? api.patch<TResult>(path, body) : api.post<TResult>(path, body);
    },
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey:
          campaignId === null
            ? campaignKeys.standaloneContent(labelId)
            : campaignKeys.campaign(labelId, campaignId),
      });
      void client.invalidateQueries({ queryKey: ['workspace'] });
    },
  });
}

/**
 * Follows one background job to completion.
 *
 * Generation runs on the worker, so a stage action returns a job rather than a
 * result. This polls that job and, when it finishes, invalidates the campaign
 * view so the produced artefacts appear. Polling stops the moment the job is
 * terminal, so a finished screen makes no requests.
 *
 * Progress and failure both come from the server: a failed job carries a Dutch
 * message the UI renders as-is, so a provider outage reads as an outage rather
 * than as empty content.
 */
export function useJobProgress(
  labelId: string,
  /**
   * The campaign whose view the finished job changes, when there is one.
   *
   * Not every job belongs to a campaign: a course card extracted from a page
   * and a research run belong to the label. This used to be required, so the
   * Kansen screen passed the literal string `'kansen'` as a placeholder and
   * invalidated a cache key that never existed. A placeholder that means
   * "nothing" is worse than an absent value, because the next reader cannot
   * tell it from a real id.
   */
  campaignId: string | undefined,
  jobId: string | undefined,
): UseQueryResult<JobSummary, ApiClientError> {
  const client = useQueryClient();
  return useQuery<JobSummary, ApiClientError>({
    queryKey: ['job', jobId ?? 'none'],
    queryFn: async ({ signal }) => {
      const job = await api.get<JobSummary>(`/jobs/${String(jobId)}`, signal);
      if (TERMINAL.has(job.status)) {
        if (campaignId !== undefined) {
          void client.invalidateQueries({ queryKey: campaignKeys.campaign(labelId, campaignId) });
        }
        void client.invalidateQueries({ queryKey: campaignKeys.brand(labelId) });
        void client.invalidateQueries({ queryKey: campaignKeys.courses(labelId) });
        void client.invalidateQueries({ queryKey: ['personas', labelId] });
      }
      return job;
    },
    enabled: jobId !== undefined,
    retry: retryPolicy,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status !== undefined && TERMINAL.has(status)) {
        return false;
      }
      return pollIntervalMs(query.state.dataUpdatedAt, query.state.data?.startedAt);
    },
    // A hidden tab learns nothing from polling. With a hundred users this is
    // the difference between the queue being polled continuously and being
    // polled only by people actually looking at a screen.
    refetchIntervalInBackground: false,
  });
}

/**
 * Backs the poll off as a job gets older.
 *
 * A short interval matters at the start, when a fast job might already be done
 * and the user is watching. It stops mattering after a minute: a job that has
 * been generating for two minutes will not finish measurably sooner because we
 * asked more often, and at a hundred concurrent users a fixed 1.2-second poll
 * is roughly eighty requests a second of pure status checking.
 *
 * Timed from when the job started running where the server reports it, and from
 * our first observation otherwise, so a long queue wait does not by itself push
 * the interval out.
 */
function pollIntervalMs(firstSeenAt: number, startedAt: string | null | undefined): number {
  const since =
    startedAt != null && Number.isFinite(Date.parse(startedAt))
      ? Date.parse(startedAt)
      : firstSeenAt;
  const ageMs = Date.now() - since;
  if (ageMs < 20_000) {
    return 1_200;
  }
  if (ageMs < 90_000) {
    return 3_000;
  }
  return 6_000;
}

const TERMINAL = new Set<JobSummary['status']>([
  'succeeded',
  'failed',
  'dead',
  'cancelled',
]);

/**
 * Whether a job has stopped moving.
 *
 * Exported so a screen can decide what to disable while work is in flight
 * without keeping its own copy of the status list. There were two such copies,
 * and a third would have been the one that forgot `cancelled` — a panel whose
 * buttons stay disabled forever after a cancelled run.
 */
export function isTerminalJobStatus(status: JobSummary['status']): boolean {
  return TERMINAL.has(status);
}

export function useEditContent(
  labelId: string,
  /** Null for a standalone piece; only the cache key depends on it. */
  campaignId: string | null,
): UseMutationResult<
  ContentAssetVersion,
  ApiClientError,
  { assetId: string; expectedVersion: number; copy: Record<string, unknown> }
> {
  const client = useQueryClient();
  return useMutation<
    ContentAssetVersion,
    ApiClientError,
    { assetId: string; expectedVersion: number; copy: Record<string, unknown> }
  >({
    mutationFn: ({ assetId, expectedVersion, copy }) =>
      api.patch<ContentAssetVersion>(`/labels/${labelId}/content/${assetId}`, {
        expectedVersion,
        copy,
      }),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey:
          campaignId === null
            ? campaignKeys.standaloneContent(labelId)
            : campaignKeys.campaign(labelId, campaignId),
      });
    },
  });
}

export function useContentVersions(
  labelId: string,
  campaignId: string,
  assetKey: string | undefined,
): UseQueryResult<{ items: ContentAssetVersion[] }, ApiClientError> {
  return useQuery<{ items: ContentAssetVersion[] }, ApiClientError>({
    queryKey: campaignKeys.contentVersions(labelId, campaignId, assetKey ?? 'none'),
    queryFn: ({ signal }) =>
      api.get<{ items: ContentAssetVersion[] }>(
        `/labels/${labelId}/campaigns/${campaignId}/content/${String(assetKey)}/versions`,
        signal,
      ),
    enabled: assetKey !== undefined,
    retry: retryPolicy,
  });
}

/** Authorised image URL. There is no public path to a rendered image. */
export function assetImageUrl(labelId: string, assetId: string): string {
  return `/api/v1/labels/${labelId}/assets/${assetId}/file`;
}

/**
 * An uploaded file's authorised URL.
 *
 * A different route from `assetImageUrl`: uploads are user-supplied and are
 * served under their *stored* type with `nosniff` and a `sandbox` policy, never
 * under the type the client declared. There is no public or guessable form of
 * this URL — the row is label-scoped and the path is re-checked server-side.
 */
export function uploadFileUrl(labelId: string, assetId: string): string {
  return `/api/v1/labels/${labelId}/uploads/${assetId}/file`;
}

/**
 * Uploads a logo image for the label and returns its asset id.
 *
 * Uploading does not attach it: the brand profile is versioned, so the id has
 * to be saved as part of the next version. Keeping those separate means an
 * upload that turns out to be the wrong file changes nothing until it is
 * saved.
 */
export function useUploadBrandLogo(
  labelId: string,
): UseMutationResult<{ id: string }, ApiClientError, File> {
  return useMutation<{ id: string }, ApiClientError, File>({
    mutationFn: (file) => api.upload<{ id: string }>(`/labels/${labelId}/uploads/brand_logo`, file),
  });
}

// ---------------------------------------------------- results & learnings ---

/**
 * What happened after the product's part was done (P4-1, P4-2), read per
 * campaign. Publications and outcomes are campaign-scoped; learnings belong
 * to the label, because a lesson outlives the campaign that taught it.
 */
export const resultKeys = {
  publications: (labelId: string, campaignId: string) =>
    ['publications', labelId, campaignId] as const,
  outcomes: (labelId: string, campaignId: string) => ['outcomes', labelId, campaignId] as const,
  learnings: (labelId: string) => ['learnings', labelId] as const,
};

export function usePublications(
  labelId: string,
  campaignId: string,
): UseQueryResult<{ items: PublicationRecord[] }, ApiClientError> {
  return useQuery<{ items: PublicationRecord[] }, ApiClientError>({
    queryKey: resultKeys.publications(labelId, campaignId),
    queryFn: ({ signal }) =>
      api.get<{ items: PublicationRecord[] }>(
        `/labels/${labelId}/campaigns/${campaignId}/publications`,
        signal,
      ),
    retry: retryPolicy,
  });
}

export function useRecordPublication(
  labelId: string,
  campaignId: string,
): UseMutationResult<PublicationRecord, ApiClientError, PublicationInput> {
  const client = useQueryClient();
  return useMutation<PublicationRecord, ApiClientError, PublicationInput>({
    mutationFn: (input) =>
      api.post<PublicationRecord>(`/labels/${labelId}/campaigns/${campaignId}/publications`, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: resultKeys.publications(labelId, campaignId) });
    },
  });
}

export function useOutcomes(
  labelId: string,
  campaignId: string,
): UseQueryResult<{ items: OutcomeReport[] }, ApiClientError> {
  return useQuery<{ items: OutcomeReport[] }, ApiClientError>({
    queryKey: resultKeys.outcomes(labelId, campaignId),
    queryFn: ({ signal }) =>
      api.get<{ items: OutcomeReport[] }>(
        `/labels/${labelId}/campaigns/${campaignId}/outcomes`,
        signal,
      ),
    retry: retryPolicy,
  });
}

/**
 * Records figures a person read off a platform. The body is the contract's
 * *input* shape: defaulted fields may be left out and the server fills them.
 */
export function useRecordOutcome(
  labelId: string,
  campaignId: string,
): UseMutationResult<OutcomeReport, ApiClientError, OutcomeInputData> {
  const client = useQueryClient();
  return useMutation<OutcomeReport, ApiClientError, OutcomeInputData>({
    mutationFn: (input) =>
      api.post<OutcomeReport>(`/labels/${labelId}/campaigns/${campaignId}/outcomes`, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: resultKeys.outcomes(labelId, campaignId) });
    },
  });
}

export function useLearnings(
  labelId: string,
): UseQueryResult<{ items: LearningWithEvidence[] }, ApiClientError> {
  return useQuery<{ items: LearningWithEvidence[] }, ApiClientError>({
    queryKey: resultKeys.learnings(labelId),
    queryFn: ({ signal }) =>
      api.get<{ items: LearningWithEvidence[] }>(`/labels/${labelId}/learnings`, signal),
    retry: retryPolicy,
  });
}

export function useCreateLearning(
  labelId: string,
): UseMutationResult<Learning, ApiClientError, LearningInputData> {
  const client = useQueryClient();
  return useMutation<Learning, ApiClientError, LearningInputData>({
    mutationFn: (input) => api.post<Learning>(`/labels/${labelId}/learnings`, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: resultKeys.learnings(labelId) });
    },
  });
}

export function useApproveLearning(
  labelId: string,
): UseMutationResult<Learning, ApiClientError, { learningId: string }> {
  const client = useQueryClient();
  return useMutation<Learning, ApiClientError, { learningId: string }>({
    mutationFn: ({ learningId }) =>
      api.post<Learning>(`/labels/${labelId}/learnings/${learningId}/approve`, {}),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: resultKeys.learnings(labelId) });
    },
  });
}

/** Uploads a platform report and returns its asset id, for `source: 'platform_report'`. */
export function useUploadOutcomeReport(
  labelId: string,
): UseMutationResult<{ id: string }, ApiClientError, File> {
  return useMutation<{ id: string }, ApiClientError, File>({
    mutationFn: (file) =>
      api.upload<{ id: string }>(`/labels/${labelId}/uploads/outcome_report`, file),
  });
}
