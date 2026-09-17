import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import type {
  SourceImpactReport,
  LabelRole,
  CurrentUser,
  JobSummary,
  LabelBudget,
  LabelSummary,
  Permission,
  WorkspaceOverview,
} from '@c360/contracts';
import type { ApiClientError } from './client.js';
import { api } from './client.js';

/**
 * Server state access.
 *
 * `ApiClientError` is passed as the error type at every call site rather than
 * registered globally: TanStack's `Register` interface lives in an internal,
 * content-hashed chunk file, so augmenting it would silently stop working on a
 * patch upgrade. Being explicit here costs one type argument and cannot break.
 *
 * Query keys are label-scoped so switching label cannot show the previous
 * label's cached data, and mutations invalidate exactly the keys they affect.
 */

export const queryKeys = {
  me: ['me'] as const,
  labels: ['labels'] as const,
  label: (labelId: string) => ['label', labelId] as const,
  workspace: (labelId: string) => ['workspace', labelId] as const,
  budget: (labelId: string) => ['budget', labelId] as const,
  jobs: (labelId: string) => ['jobs', labelId] as const,
};

/** Never retry an authorisation or validation failure — it will not succeed. */
function retryPolicy(failureCount: number, error: ApiClientError): boolean {
  if (error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 2;
}

export function useCurrentUser(): UseQueryResult<CurrentUser, ApiClientError> {
  return useQuery<CurrentUser, ApiClientError>({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => api.get<CurrentUser>('/me', signal),
    retry: retryPolicy,
    staleTime: 60_000,
  });
}

export function useLabels(): UseQueryResult<{ items: LabelSummary[] }, ApiClientError> {
  return useQuery<{ items: LabelSummary[] }, ApiClientError>({
    queryKey: queryKeys.labels,
    queryFn: ({ signal }) => api.get<{ items: LabelSummary[] }>('/labels', signal),
    retry: retryPolicy,
    staleTime: 60_000,
  });
}

interface LabelDetail {
  label: LabelSummary;
  /** Advisory, for rendering only. Every route re-checks server-side. */
  permissions: Permission[];
}

export function useLabelDetail(
  labelId: string | undefined,
): UseQueryResult<LabelDetail, ApiClientError> {
  return useQuery<LabelDetail, ApiClientError>({
    queryKey: queryKeys.label(labelId ?? 'none'),
    queryFn: ({ signal }) => api.get<LabelDetail>(`/labels/${String(labelId)}`, signal),
    enabled: labelId !== undefined,
    retry: retryPolicy,
  });
}

export function useWorkspace(
  labelId: string | undefined,
): UseQueryResult<WorkspaceOverview, ApiClientError> {
  return useQuery<WorkspaceOverview, ApiClientError>({
    queryKey: queryKeys.workspace(labelId ?? 'none'),
    queryFn: ({ signal }) =>
      api.get<WorkspaceOverview>(`/labels/${String(labelId)}/workspace`, signal),
    enabled: labelId !== undefined,
    retry: retryPolicy,
  });
}

/**
 * "A source changed — what does that touch?"
 *
 * The report has existed on the server since P4-3 and was shown to nobody
 * until 2026-09-15; the audit found it as fully built and unreachable. It is
 * a read with no action attached, by design: what to do about a changed
 * source depends on what changed.
 */
export function useSourceImpact(
  labelId: string | undefined,
): UseQueryResult<SourceImpactReport, ApiClientError> {
  return useQuery<SourceImpactReport, ApiClientError>({
    queryKey: ['source-impact', labelId ?? 'none'],
    queryFn: ({ signal }) =>
      api.get<SourceImpactReport>(`/labels/${String(labelId)}/source-impact`, signal),
    enabled: labelId !== undefined,
    retry: retryPolicy,
  });
}

export function useBudget(
  labelId: string | undefined,
): UseQueryResult<LabelBudget, ApiClientError> {
  return useQuery<LabelBudget, ApiClientError>({
    queryKey: queryKeys.budget(labelId ?? 'none'),
    queryFn: ({ signal }) => api.get<LabelBudget>(`/labels/${String(labelId)}/budget`, signal),
    enabled: labelId !== undefined,
    retry: retryPolicy,
  });
}

interface JobList {
  items: JobSummary[];
}

/**
 * Job list.
 *
 * Polls while any job is still running so progress is visible without the user
 * refreshing; stops polling once everything is terminal, so an idle screen
 * makes no requests at all.
 */
export function useJobs(labelId: string | undefined): UseQueryResult<JobList, ApiClientError> {
  return useQuery<JobList, ApiClientError>({
    queryKey: queryKeys.jobs(labelId ?? 'none'),
    queryFn: ({ signal }) =>
      api.get<JobList>(`/labels/${String(labelId)}/jobs?limit=25`, signal),
    enabled: labelId !== undefined,
    retry: retryPolicy,
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const active = items.some(
        (job) =>
          job.status === 'queued' || job.status === 'running' || job.status === 'cancelling',
      );
      return active ? 1_500 : false;
    },
  });
}

interface DemoJobInput {
  labelId: string;
  message: string;
  steps: number;
  failFirstAttempts: number;
}

export function useStartDemoJob(): UseMutationResult<JobSummary, ApiClientError, DemoJobInput> {
  const client = useQueryClient();
  return useMutation<JobSummary, ApiClientError, DemoJobInput>({
    mutationFn: (input) =>
      api.post<JobSummary>(`/labels/${input.labelId}/jobs/demo`, {
        message: input.message,
        steps: input.steps,
        failFirstAttempts: input.failFirstAttempts,
      }),
    onSuccess: (_job, input) => {
      void client.invalidateQueries({ queryKey: queryKeys.jobs(input.labelId) });
      void client.invalidateQueries({ queryKey: queryKeys.budget(input.labelId) });
    },
  });
}

interface JobActionInput {
  jobId: string;
  labelId: string;
}

export function useJobAction(
  action: 'cancel' | 'retry',
): UseMutationResult<JobSummary, ApiClientError, JobActionInput> {
  const client = useQueryClient();
  return useMutation<JobSummary, ApiClientError, JobActionInput>({
    mutationFn: ({ jobId }) => api.post<JobSummary>(`/jobs/${jobId}/${action}`),
    onSuccess: (_job, { labelId }) => {
      void client.invalidateQueries({ queryKey: queryKeys.jobs(labelId) });
      void client.invalidateQueries({ queryKey: queryKeys.budget(labelId) });
      void client.invalidateQueries({ queryKey: queryKeys.workspace(labelId) });
    },
  });
}

// --------------------------------------------------------------- members ---

/**
 * Label membership administration.
 *
 * Two queries with different authority behind them, which is why they are
 * separate hooks rather than one: the member list needs `member:read` **within
 * the label**, so a manager sees their own team; the candidate list is
 * organisation-scoped and needs `member:manage`, which only an organisation
 * role grants. A manager therefore gets a 403 on the second one, and the screen
 * treats that as "you may look, not change" rather than as an error.
 */

export interface LabelMember {
  userId: string;
  displayName: string;
  email: string;
  orgRole: string;
  role: LabelRole;
  isActive: boolean;
  createdAt: string;
}

export interface MemberCandidate {
  userId: string;
  displayName: string;
  email: string;
  orgRole: string;
  isActive: boolean;
  labelCount: number;
}

export function useLabelMembers(
  labelId: string | undefined,
): UseQueryResult<{ items: LabelMember[] }, ApiClientError> {
  return useQuery<{ items: LabelMember[] }, ApiClientError>({
    queryKey: ['members', labelId ?? 'none'],
    queryFn: ({ signal }) =>
      api.get<{ items: LabelMember[] }>(`/labels/${String(labelId)}/members`, signal),
    enabled: labelId !== undefined,
    retry: retryPolicy,
  });
}

export function useMemberCandidates(
  labelId: string | undefined,
): UseQueryResult<{ items: MemberCandidate[] }, ApiClientError> {
  return useQuery<{ items: MemberCandidate[] }, ApiClientError>({
    queryKey: ['member-candidates', labelId ?? 'none'],
    queryFn: ({ signal }) =>
      api.get<{ items: MemberCandidate[] }>(
        `/labels/${String(labelId)}/members/candidates`,
        signal,
      ),
    enabled: labelId !== undefined,
    // A 403 here means "you may read the team but not change it", which is a
    // normal state for a label manager rather than a failure to retry.
    retry: retryPolicy,
  });
}

export function useSetMemberRole(
  labelId: string,
): UseMutationResult<LabelMember, ApiClientError, { userId: string; role: LabelRole }> {
  const client = useQueryClient();
  return useMutation<LabelMember, ApiClientError, { userId: string; role: LabelRole }>({
    mutationFn: ({ userId, role }) =>
      api.patch<LabelMember>(`/labels/${labelId}/members/${userId}`, { role }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['members', labelId] });
      void client.invalidateQueries({ queryKey: ['member-candidates', labelId] });
      // The caller's own access may have changed, and it takes effect on the
      // next request — so the identity and label lists are refetched too.
      void client.invalidateQueries({ queryKey: queryKeys.me });
      void client.invalidateQueries({ queryKey: queryKeys.labels });
    },
  });
}

export function useRevokeMember(
  labelId: string,
): UseMutationResult<{ revoked: true }, ApiClientError, { userId: string }> {
  const client = useQueryClient();
  return useMutation<{ revoked: true }, ApiClientError, { userId: string }>({
    mutationFn: ({ userId }) =>
      api.remove<{ revoked: true }>(`/labels/${labelId}/members/${userId}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['members', labelId] });
      void client.invalidateQueries({ queryKey: ['member-candidates', labelId] });
      void client.invalidateQueries({ queryKey: queryKeys.me });
      void client.invalidateQueries({ queryKey: queryKeys.labels });
    },
  });
}
