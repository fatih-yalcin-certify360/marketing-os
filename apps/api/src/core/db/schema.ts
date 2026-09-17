import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Typed mirror of the hand-written SQL in `apps/api/db/migrations`.
 *
 * The SQL files are authoritative (ADR-0005): they own constraints, partial
 * indexes and composite foreign keys that a generator would not produce. This
 * file exists to give queries static types. Drift between the two is caught by
 * `tests/integration/schema-parity.test.ts`, which applies the migrations to a
 * real PostgreSQL and then asserts every column declared here exists with a
 * compatible type.
 */

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdateFn(() => new Date());

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  createdAt,
  updatedAt,
});

export const labels = pgTable(
  'labels',
  {
    brandPortalSlug: text('brand_portal_slug'),
    brandPortalCheckedAt: timestamp('brand_portal_checked_at', { withTimezone: true }),
    brandPortalError: text('brand_portal_error'),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    origin: text('origin').notNull().default('user'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex('labels_org_slug_unique').on(table.organizationId, table.slug)],
);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid('organization_id').notNull(),
  externalSubject: text('external_subject').notNull(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  orgRole: text('org_role').notNull().default('org_member'),
  authSource: text('auth_source').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt,
  updatedAt,
});

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id').notNull(),
    userId: uuid('user_id').notNull(),
    labelId: uuid('label_id').notNull(),
    role: text('role').notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('memberships_user_label_unique').on(table.userId, table.labelId),
    index('memberships_user_idx').on(table.userId),
  ],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    labelId: uuid('label_id'),
    actorKind: text('actor_kind').notNull(),
    actorUserId: uuid('actor_user_id'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    outcome: text('outcome').notNull(),
    reason: text('reason'),
    requestId: text('request_id'),
    ipHash: text('ip_hash'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt,
  },
  (table) => [index('audit_events_org_created_idx').on(table.organizationId, table.createdAt)],
);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id').notNull(),
    labelId: uuid('label_id'),
    type: text('type').notNull(),
    status: text('status').notNull().default('queued'),
    priority: integer('priority').notNull().default(100),
    payload: jsonb('payload').notNull().default({}),
    result: jsonb('result'),
    progress: jsonb('progress'),
    attempt: integer('attempt').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    idempotencyKey: text('idempotency_key').notNull(),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    claimedBy: text('claimed_by'),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    failureKind: text('failure_kind'),
    failureMessage: text('failure_message'),
    reservedCostCents: integer('reserved_cost_cents').notNull().default(0),
    actualCostCents: integer('actual_cost_cents'),
    createdByUserId: uuid('created_by_user_id'),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('jobs_idempotency_unique').on(table.organizationId, table.type, table.idempotencyKey),
    index('jobs_org_created_idx').on(table.organizationId, table.createdAt),
  ],
);

export const labelBudgets = pgTable(
  'label_budgets',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id').notNull(),
    labelId: uuid('label_id').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    budgetCents: integer('budget_cents').notNull(),
    spentCents: integer('spent_cents').notNull().default(0),
    reservedCents: integer('reserved_cents').notNull().default(0),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('label_budgets_label_period_unique').on(table.labelId, table.periodStart),
  ],
);

export const usageRecords = pgTable('usage_records', {
  unitKey: text('unit_key').notNull().default(''),
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  labelId: uuid('label_id'),
  jobId: uuid('job_id'),
  attempt: integer('attempt').notNull().default(0),
  kind: text('kind').notNull(),
  provider: text('provider').notNull(),
  model: text('model'),
  promptTemplate: text('prompt_template'),
  promptVersion: text('prompt_version'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  imageCount: integer('image_count'),
  estimatedCostCents: integer('estimated_cost_cents').notNull().default(0),
  actualCostCents: integer('actual_cost_cents'),
  latencyMs: integer('latency_ms'),
  createdAt,
});


// ---------------------------------------------------------------------------
// Phase 1/2 tables — brand, courses, personas, campaigns, content.
// Mirrors migrations 0004–0006. `schema-parity.test.ts` proves they match.
// ---------------------------------------------------------------------------

export const assets = pgTable(
  'assets',
  {
    aiJobId: uuid('ai_job_id'),
    aiRequestKey: text('ai_request_key'),
    aiProvenance: jsonb('ai_provenance'),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id').notNull(),
    labelId: uuid('label_id').notNull(),
    kind: text('kind').notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    sha256: text('sha256').notNull(),
    storagePath: text('storage_path').notNull(),
    originalName: text('original_name'),
    widthPx: integer('width_px'),
    heightPx: integer('height_px'),
    createdByUserId: uuid('created_by_user_id'),
    createdAt,
  },
  (table) => [uniqueIndex('assets_label_sha_kind_unique').on(table.labelId, table.sha256, table.kind)],
);

export const brandProfileVersions = pgTable(
  'brand_profile_versions',
  {
    portal: jsonb('portal'),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id').notNull(),
    labelId: uuid('label_id').notNull(),
    version: integer('version').notNull(),
    brandName: text('brand_name').notNull(),
    colors: jsonb('colors').notNull(),
    typography: jsonb('typography').notNull(),
    tone: jsonb('tone').notNull(),
    rules: jsonb('rules').notNull().default([]),
    exampleContent: text('example_content').notNull().default(''),
    logoText: text('logo_text'),
    logoAssetId: uuid('logo_asset_id'),
    imageUsageNote: text('image_usage_note'),
    reviewState: text('review_state').notNull().default('draft'),
    origin: text('origin').notNull().default('user'),
    promptVersion: text('prompt_version'),
    createdByUserId: uuid('created_by_user_id'),
    createdAt,
  },
  (table) => [uniqueIndex('brand_label_version_unique').on(table.labelId, table.version)],
);

export const courseVersions = pgTable(
  'course_versions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id').notNull(),
    labelId: uuid('label_id').notNull(),
    courseKey: text('course_key').notNull(),
    version: integer('version').notNull(),
    name: text('name').notNull(),
    externalCode: text('external_code'),
    sourceKind: text('source_kind').notNull().default('manual'),
    sourceRef: text('source_ref'),
    courseUrl: text('course_url'),
    facts: jsonb('facts').notNull(),
    priceCents: integer('price_cents'),
    priceNote: text('price_note'),
    dates: jsonb('dates').notNull().default([]),
    reviewState: text('review_state').notNull().default('draft'),
    origin: text('origin').notNull().default('user'),
    promptVersion: text('prompt_version'),
    createdByUserId: uuid('created_by_user_id'),
    createdAt,
  },
  (table) => [
    uniqueIndex('course_key_version_unique').on(table.labelId, table.courseKey, table.version),
  ],
);

export const personaVersions = pgTable(
  'persona_versions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id').notNull(),
    labelId: uuid('label_id').notNull(),
    campaignId: uuid('campaign_id'),
    personaKey: text('persona_key').notNull(),
    version: integer('version').notNull(),
    courseVersionId: uuid('course_version_id').notNull(),
    name: text('name').notNull(),
    summary: text('summary').notNull(),
    need: text('need').notNull(),
    motivation: text('motivation').notNull(),
    barriers: jsonb('barriers').notNull().default([]),
    decisionCriteria: jsonb('decision_criteria').notNull().default([]),
    relationToCourse: text('relation_to_course').notNull(),
    grounding: jsonb('grounding').notNull().default([]),
    assumptions: jsonb('assumptions').notNull().default([]),
    /** Where the audience orients, per statement with evidence or null for an assumption. */
    orientationSources: jsonb('orientation_sources').notNull().default([]),
    questionnaire: jsonb('questionnaire').notNull().default({}),
    /** Other course versions this persona is linked to; see migration 0025. */
    linkedCourseVersionIds: jsonb('linked_course_version_ids').notNull().default([]),
    reviewState: text('review_state').notNull().default('draft'),
    origin: text('origin').notNull().default('ai_generated'),
    promptVersion: text('prompt_version'),
    createdByUserId: uuid('created_by_user_id'),
    createdAt,
  },
  (table) => [
    uniqueIndex('persona_key_version_unique').on(table.labelId, table.personaKey, table.version),
  ],
);

export const opportunities = pgTable('opportunities', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid('organization_id').notNull(),
  labelId: uuid('label_id').notNull(),
  courseVersionId: uuid('course_version_id').notNull(),
  proposalSetId: uuid('proposal_set_id').notNull(),
  personaVersionIds: jsonb('persona_version_ids').notNull(),
  title: text('title').notNull(),
  goalAndNeed: text('goal_and_need').notNull(),
  coreIdea: text('core_idea').notNull(),
  sourceAndTiming: text('source_and_timing').notNull(),
  fitNotes: text('fit_notes').notNull(),
  uncertainties: jsonb('uncertainties').notNull().default([]),
  smallTestProposal: text('small_test_proposal').notNull(),
  measurementApproach: text('measurement_approach').notNull(),
  rank: integer('rank').notNull(),
  rankRationaleNl: text('rank_rationale_nl').notNull(),
  grounding: jsonb('grounding').notNull().default([]),
  selected: boolean('selected').notNull().default(false),
  origin: text('origin').notNull().default('ai_generated'),
  promptVersion: text('prompt_version'),
  createdAt,
});

export const campaigns = pgTable('campaigns', {
  radarRunId: uuid('radar_run_id'),
  visualReferenceAssetIds: jsonb('visual_reference_asset_ids').notNull().default([]),
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid('organization_id').notNull(),
  labelId: uuid('label_id').notNull(),
  name: text('name').notNull(),
  entryMode: text('entry_mode').notNull(),
  /** What the campaign must achieve; null for campaigns from before objectives existed. */
  objective: text('objective'),
  stage: text('stage').notNull().default('label_course'),
  contentLanguage: text('content_language').notNull().default('nl'),
  courseVersionId: uuid('course_version_id').notNull(),
  brandProfileVersionId: uuid('brand_profile_version_id').notNull(),
  opportunityId: uuid('opportunity_id'),
  userIdea: text('user_idea'),
  suppliedBrief: text('supplied_brief'),
  ownerUserId: uuid('owner_user_id'),
  startDate: date('start_date'),
  budgetCents: integer('budget_cents'),
  createdAt,
  updatedAt,
});

export const briefVersions = pgTable(
  'brief_versions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id').notNull(),
    labelId: uuid('label_id').notNull(),
    campaignId: uuid('campaign_id').notNull(),
    version: integer('version').notNull(),
    reviewNotes: jsonb('review_notes').notNull().default([]),
    goal: text('goal').notNull(),
    personaVersionIds: jsonb('persona_version_ids').notNull(),
    coreMessage: text('core_message').notNull(),
    /** The thesis per funnel stage: message, CTA kind and confirmed proof fields. */
    stageMessages: jsonb('stage_messages').notNull().default([]),
    /** Search phrases the content should carry, each with its provenance; no figures. */
    keywords: jsonb('keywords').notNull().default([]),
    /** The sections of a professional brief; see migration 0026. */
    contextNl: text('context_nl').notNull().default(''),
    audienceInsightNl: text('audience_insight_nl').notNull().default(''),
    propositionNl: text('proposition_nl').notNull().default(''),
    toneOfVoiceNl: text('tone_of_voice_nl').notNull().default(''),
    mandatories: jsonb('mandatories').notNull().default([]),
    channelRoles: jsonb('channel_roles').notNull().default([]),
    timingNl: text('timing_nl').notNull().default(''),
    risks: jsonb('risks').notNull().default([]),
    evidence: jsonb('evidence').notNull().default([]),
    usableClaims: jsonb('usable_claims').notNull().default([]),
    offLimits: jsonb('off_limits').notNull().default([]),
    cta: text('cta').notNull(),
    ctaUrl: text('cta_url'),
    channelSuggestions: jsonb('channel_suggestions').notNull().default([]),
    contentScope: text('content_scope').notNull(),
    measurement: text('measurement').notNull(),
    stopConditions: text('stop_conditions').notNull(),
    ownerUserId: uuid('owner_user_id'),
    budgetCents: integer('budget_cents'),
    startDate: date('start_date'),
    reviewState: text('review_state').notNull().default('draft'),
    origin: text('origin').notNull().default('ai_generated'),
    promptVersion: text('prompt_version'),
    createdAt,
  },
  (table) => [uniqueIndex('brief_campaign_version_unique').on(table.campaignId, table.version)],
);

export const conceptVersions = pgTable(
  'concept_versions',
  {
    artDirection: jsonb('art_direction'),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id').notNull(),
    labelId: uuid('label_id').notNull(),
    campaignId: uuid('campaign_id').notNull(),
    briefVersionId: uuid('brief_version_id').notNull(),
    conceptKey: text('concept_key').notNull(),
    version: integer('version').notNull(),
    name: text('name').notNull(),
    coreIdea: text('core_idea').notNull(),
    exampleHeadline: text('example_headline').notNull(),
    visualApproach: text('visual_approach').notNull(),
    visualLayout: text('visual_layout').notNull(),
    personaFitRationaleNl: text('persona_fit_rationale_nl').notNull(),
    selected: boolean('selected').notNull().default(false),
    reviewState: text('review_state').notNull().default('draft'),
    origin: text('origin').notNull().default('ai_generated'),
    promptVersion: text('prompt_version'),
    createdAt,
  },
  (table) => [
    uniqueIndex('concept_key_version_unique').on(table.campaignId, table.conceptKey, table.version),
  ],
);

export const contentPlans = pgTable(
  'content_plans',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id').notNull(),
    labelId: uuid('label_id').notNull(),
    campaignId: uuid('campaign_id').notNull(),
    version: integer('version').notNull(),
    items: jsonb('items').notNull(),
    cadenceNl: text('cadence_nl').notNull(),
    rationaleNl: text('rationale_nl').notNull(),
    /** Rule verdict, advised verdict and reasoning per stage × channel cell. */
    channelAdvice: jsonb('channel_advice').notNull().default([]),
    /** One indicator, source and decision rule per stage; no target, no forecast. */
    measurementPlan: jsonb('measurement_plan').notNull().default([]),
    reviewState: text('review_state').notNull().default('draft'),
    origin: text('origin').notNull().default('ai_generated'),
    createdAt,
  },
  (table) => [
    uniqueIndex('content_plan_campaign_version_unique').on(table.campaignId, table.version),
  ],
);

export const contentAssetVersions = pgTable(
  'content_asset_versions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id').notNull(),
    labelId: uuid('label_id').notNull(),
    /** Null for a standalone piece; see `ownerScope` (migration 0029). */
    campaignId: uuid('campaign_id'),
    assetKey: text('asset_key').notNull(),
    version: integer('version').notNull(),
    channel: text('channel').notNull(),
    /** The funnel stage the piece was written for; null for stage-less content. */
    funnelStage: text('funnel_stage'),
    format: text('format').notNull().default('single_image'),
    language: text('language').notNull().default('nl'),
    copy: jsonb('copy').notNull(),
    variants: jsonb('variants').notNull().default([]),
    briefVersionId: uuid('brief_version_id'),
    conceptVersionId: uuid('concept_version_id'),
    // Still required for both scopes: a piece always belongs to a brand and a
    // course, and that grounding is what makes a briefless piece safe.
    brandProfileVersionId: uuid('brand_profile_version_id').notNull(),
    courseVersionId: uuid('course_version_id').notNull(),
    /** `campaign` or `standalone`; a CHECK ties it to `campaignId`. */
    ownerScope: text('owner_scope').notNull().default('campaign'),
    /** Where a standalone piece came from: a finding, a card, or a person. */
    originKind: text('origin_kind'),
    originRefId: uuid('origin_ref_id'),
    personaVersionIds: jsonb('persona_version_ids').notNull().default([]),
    warnings: jsonb('warnings').notNull().default([]),
    /**
     * Which channel-specification version this was judged against.
     *
     * The stored `warnings` are the verdict at the time; the operative ones are
     * recomputed from the current config on read, so the interface and the
     * export can never disagree. This column is what keeps the history
     * answerable.
     */
    channelConfigVersion: integer('channel_config_version').notNull().default(1),
    reviewState: text('review_state').notNull().default('draft'),
    origin: text('origin').notNull().default('ai_generated'),
    promptVersion: text('prompt_version'),
    editedByUserId: uuid('edited_by_user_id'),
    createdByUserId: uuid('created_by_user_id'),
    createdAt,
  },
  (table) => [
    uniqueIndex('content_key_version_unique').on(table.campaignId, table.assetKey, table.version),
    index('content_label_review_state_idx').on(table.labelId, table.reviewState),
  ],
);

export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id').notNull(),
    labelId: uuid('label_id').notNull(),
    artefactType: text('artefact_type').notNull(),
    artefactId: uuid('artefact_id').notNull(),
    artefactVersion: integer('artefact_version').notNull(),
    approvedByUserId: uuid('approved_by_user_id').notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true }).notNull().defaultNow(),
    noteNl: text('note_nl'),
  },
  (table) => [
    uniqueIndex('approval_unique').on(table.artefactType, table.artefactId, table.artefactVersion),
  ],
);

export const exports = pgTable('exports', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid('organization_id').notNull(),
  labelId: uuid('label_id').notNull(),
  campaignId: uuid('campaign_id').notNull(),
  kind: text('kind').notNull(),
  manifest: jsonb('manifest').notNull().default([]),
  blockedReasonsNl: jsonb('blocked_reasons_nl').notNull().default([]),
  assetId: uuid('asset_id'),
  sizeBytes: integer('size_bytes').notNull().default(0),
  createdByUserId: uuid('created_by_user_id'),
  createdAt,
});

export const publicationRecords = pgTable('publication_records', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid('organization_id').notNull(),
  labelId: uuid('label_id').notNull(),
  campaignId: uuid('campaign_id').notNull(),
  contentAssetVersionId: uuid('content_asset_version_id').notNull(),
  channel: text('channel').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
  externalUrl: text('external_url'),
  noteNl: text('note_nl'),
  recordedByUserId: uuid('recorded_by_user_id'),
  createdAt,
});

/**
 * A conclusion a person drew, and what would test it.
 *
 * Three fields rather than one, because a single "conclusion" column invites a
 * sentence that reads as a proven cause: `observationNl` is what was measured,
 * `hypothesisNl` is what the author thinks it means, and `nextTestNl` is what
 * would confirm or refute it. A hypothesis nobody could test is an opinion.
 *
 * Nothing here points at a persona or a brand profile, and nothing in the
 * module can write one — an approved learning is context handed to a later
 * proposal, which a person then reviews like any other. The SQL carries the
 * length floors and the approval-completeness check.
 */
export const learnings = pgTable('learnings', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid('organization_id').notNull(),
  labelId: uuid('label_id').notNull(),
  originCampaignId: uuid('origin_campaign_id'),
  observationNl: text('observation_nl').notNull(),
  hypothesisNl: text('hypothesis_nl').notNull(),
  nextTestNl: text('next_test_nl').notNull(),
  reviewState: text('review_state').notNull().default('draft'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedByUserId: uuid('approved_by_user_id'),
  createdByUserId: uuid('created_by_user_id'),
  createdAt,
  updatedAt,
});

/** Which measured outcomes a learning rests on. */
export const learningEvidence = pgTable(
  'learning_evidence',
  {
    learningId: uuid('learning_id').notNull(),
    outcomeReportId: uuid('outcome_report_id').notNull(),
  },
  (table) => [primaryKey({ columns: [table.learningId, table.outcomeReportId] })],
);

/**
 * Measured results, and where each figure came from.
 *
 * The SQL is the authority, as always, and it carries constraints this mirror
 * cannot express: a period that must be ordered, metrics that must not be
 * negative, at least one figure per row, and a platform-report row that must
 * actually have the report attached. See `0018_outcomes.sql` for why.
 *
 * Every metric is nullable on purpose. A platform reports what it reports, and
 * `NULL` means "not reported" while `0` means "reported as none" — collapsing
 * the two would turn an absence into a measurement.
 */
export const outcomeReports = pgTable('outcome_reports', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid('organization_id').notNull(),
  labelId: uuid('label_id').notNull(),
  campaignId: uuid('campaign_id').notNull(),
  publicationRecordId: uuid('publication_record_id'),
  channel: text('channel').notNull(),
  /** The stage the figures belong to, when the report splits by stage. */
  funnelStage: text('funnel_stage'),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  impressions: integer('impressions'),
  clicks: integer('clicks'),
  signups: integer('signups'),
  spendCents: integer('spend_cents'),
  source: text('source').notNull(),
  reportAssetId: uuid('report_asset_id'),
  noteNl: text('note_nl'),
  recordedByUserId: uuid('recorded_by_user_id'),
  createdAt,
});

/**
 * Sources a label has decided are worth reading.
 *
 * A source is a page or a document, never both — the SQL enforces that with a
 * check constraint, which cannot be expressed here, so the migration is the
 * authority as always.
 */
export const sources = pgTable(
  'sources',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id').notNull(),
    labelId: uuid('label_id').notNull(),
    kind: text('kind').notNull(),
    url: text('url'),
    assetId: uuid('asset_id'),
    title: text('title').notNull(),
    timeSensitivity: text('time_sensitivity').notNull().default('medium'),
    contentSha256: text('content_sha256'),
    lastRetrievedAt: timestamp('last_retrieved_at', { withTimezone: true }),
    lastFailureNl: text('last_failure_nl'),
    isActive: boolean('is_active').notNull().default(true),
    createdByUserId: uuid('created_by_user_id'),
    createdAt,
    updatedAt,
  },
  (table) => [index('sources_label_active_idx').on(table.labelId)],
);

export const researchRuns = pgTable(
  'research_runs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id').notNull(),
    labelId: uuid('label_id').notNull(),
    courseVersionId: uuid('course_version_id').notNull(),
    version: integer('version').notNull(),
    status: text('status').notNull().default('running'),
    sourcesSnapshot: jsonb('sources_snapshot').notNull().default([]),
    findingCount: integer('finding_count').notNull().default(0),
    shortfallReasonNl: text('shortfall_reason_nl'),
    promptVersion: text('prompt_version'),
    failureNl: text('failure_nl'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id'),
  },
  (table) => [
    uniqueIndex('research_runs_course_version_unique').on(table.courseVersionId, table.version),
  ],
);

/**
 * One claim with its provenance.
 *
 * `sourceRef`, `retrievedAt` and `excerpt` are all `notNull` on purpose: a
 * claim with no passage behind it cannot be checked, so it is not a finding.
 */
export const researchFindings = pgTable(
  'research_findings',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id').notNull(),
    labelId: uuid('label_id').notNull(),
    runId: uuid('run_id').notNull(),
    sourceId: uuid('source_id'),
    claim: text('claim').notNull(),
    kind: text('kind').notNull(),
    sourceRef: text('source_ref').notNull(),
    retrievedAt: timestamp('retrieved_at', { withTimezone: true }).notNull(),
    excerpt: text('excerpt').notNull(),
    uncertaintyNl: text('uncertainty_nl'),
    createdAt,
  },
  (table) => [index('research_findings_run_idx').on(table.runId)],
);

export const radarRuns = pgTable('radar_runs', {
 id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
 organizationId: uuid('organization_id').notNull(), labelId: uuid('label_id').notNull(),
 courseVersionId: uuid('course_version_id').notNull(), jobId: uuid('job_id'),
 report: jsonb('report').notNull(), createdAt,
});

export const campaignPackages = pgTable('campaign_packages', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid('organization_id').notNull(), labelId: uuid('label_id').notNull(),
  campaignId: uuid('campaign_id').notNull(), jobId: uuid('job_id'),
  report: jsonb('report').notNull(), createdAt,
});

export const schema = {
  campaignPackages,
  radarRuns,
  organizations,
  labels,
  users,
  memberships,
  auditEvents,
  jobs,
  labelBudgets,
  usageRecords,
  assets,
  brandProfileVersions,
  courseVersions,
  personaVersions,
  opportunities,
  campaigns,
  briefVersions,
  conceptVersions,
  contentPlans,
  contentAssetVersions,
  approvals,
  exports,
  learningEvidence,
  learnings,
  outcomeReports,
  publicationRecords,
  sources,
  researchRuns,
  researchFindings,
};

export type Schema = typeof schema;

