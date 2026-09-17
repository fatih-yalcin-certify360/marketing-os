import { z } from 'zod';

/**
 * The campaign chain and its gates.
 *
 * A stage may be entered only when every gate listed in `STAGE_PREREQUISITES`
 * has been satisfied. A saved persona or an approved brief lets a user resume
 * further along the chain, but the prerequisite list is still checked — so
 * re-entry can skip *work*, never a *control*.
 */

export const workflowStage = z.enum([
  'label_course',
  'research',
  'persona_selection',
  'opportunity_selection',
  'brief_approval',
  'concept_selection',
  'content_plan_approval',
  'production',
  'editing',
  'final_approval',
  'export',
  'results',
  'learnings',
]);
export type WorkflowStage = z.infer<typeof workflowStage>;

/** How the user entered the campaign chain. */
export const campaignEntryMode = z.enum([
  /** "Ontdek kansen" — start from label + course, system researches. */
  'discover_opportunities',
  /** "Werk mijn idee uit" — start from the user's own idea. */
  'develop_my_idea',
  /** "Start met een briefing" — start from a supplied brief. */
  'start_from_briefing',
]);
export type CampaignEntryMode = z.infer<typeof campaignEntryMode>;

/**
 * Named controls that gate stage transitions. Each is checked server-side
 * against database state, never against a client-supplied flag.
 */
export const workflowGate = z.enum([
  'course_version_confirmed',
  'brand_profile_approved',
  'persona_versions_selected',
  'opportunity_selected',
  'brief_version_approved',
  'concept_version_selected',
  'content_plan_approved',
  'all_assets_have_current_approval',
  'no_stale_dependencies',
  'required_cta_links_present',
  // Added 2026-09-15. The first named the refusal that already existed but
  // carried no gate id, so it never appeared in the checklist. The second is
  // new: the registry's hard constraints — accepted format, pixel cap, byte
  // cap, alt-text limit — were declared and read nowhere.
  'channel_specs_verified',
  'assets_within_channel_limits',
]);
export type WorkflowGate = z.infer<typeof workflowGate>;

export const STAGE_PREREQUISITES: Readonly<Record<WorkflowStage, readonly WorkflowGate[]>> =
  Object.freeze({
    label_course: [],
    research: [],
    persona_selection: [],
    opportunity_selection: ['persona_versions_selected'],
    brief_approval: ['persona_versions_selected', 'opportunity_selected'],
    concept_selection: ['brief_version_approved'],
    content_plan_approval: ['brief_version_approved', 'concept_version_selected'],
    production: ['brief_version_approved', 'concept_version_selected', 'content_plan_approved'],
    editing: ['content_plan_approved'],
    final_approval: ['content_plan_approved', 'no_stale_dependencies'],
    export: ['content_plan_approved'],
    results: [],
    learnings: [],
  });

/**
 * Extra gates required specifically for a *publish-ready* export. A draft
 * export is always allowed and is labelled as a draft; a publish-ready package
 * additionally demands current approvals, no stale dependencies and complete
 * CTA links.
 */
export const PUBLISH_READY_GATES: readonly WorkflowGate[] = Object.freeze([
  'course_version_confirmed',
  'brand_profile_approved',
  'all_assets_have_current_approval',
  'no_stale_dependencies',
  'required_cta_links_present',
  'channel_specs_verified',
  'assets_within_channel_limits',
]);

/** Dutch labels for gates, so failures can be explained in the UI. */
export const GATE_LABEL_NL: Readonly<Record<WorkflowGate, string>> = Object.freeze({
  course_version_confirmed: 'Opleidingsinformatie is gecontroleerd en vastgelegd',
  brand_profile_approved: 'Merkprofiel is goedgekeurd',
  persona_versions_selected: 'Doelgroepen zijn gekozen',
  opportunity_selected: 'Kans is gekozen',
  brief_version_approved: 'Briefing is goedgekeurd',
  concept_version_selected: 'Concept is gekozen',
  // "Kanaalplan", not "contentpakket": the latter also names the campaign
  // package and the export ZIP, and one word for three things confused readers.
  content_plan_approved: 'Kanaalplan is goedgekeurd',
  all_assets_have_current_approval: 'Alle content heeft een geldige goedkeuring',
  no_stale_dependencies: 'Er zijn geen gewijzigde onderliggende bronnen',
  required_cta_links_present: 'Alle verplichte CTA-links zijn ingevuld',
  channel_specs_verified: 'Alle kanaalspecificaties zijn tegen een officiële bron gecontroleerd',
  assets_within_channel_limits: 'Alle beelden en alt-teksten passen binnen de kanaalgrenzen',
});

/**
 * Lifecycle of any versioned, reviewable artefact (brief, concept, content
 * asset, persona). `needs_rereview` is reached automatically when a dependency
 * changes — an approval is bound to one specific version and does not carry
 * over, which is what makes that transition safe.
 */
export const reviewState = z.enum([
  'draft',
  'in_review',
  'changes_requested',
  'approved',
  'needs_rereview',
  'archived',
]);
export type ReviewState = z.infer<typeof reviewState>;

/** States in which an artefact counts as approved for a publish-ready export. */
export const APPROVED_STATES: readonly ReviewState[] = Object.freeze(['approved']);

/**
 * Which required gates are not yet satisfied.
 *
 * Pure and total: given the set of gates that have actually passed, it returns
 * the shortfall. Callers use it for two distinct decisions that must never
 * collapse into one — entering a stage, and building a *publish-ready* export.
 * A draft export deliberately does not consult it.
 */
export function missingGates(
  passed: ReadonlySet<WorkflowGate>,
  required: readonly WorkflowGate[],
): WorkflowGate[] {
  return required.filter((gate) => !passed.has(gate));
}

export function canEnterStage(
  passed: ReadonlySet<WorkflowGate>,
  stage: WorkflowStage,
): { allowed: boolean; missing: WorkflowGate[] } {
  const missing = missingGates(passed, STAGE_PREREQUISITES[stage]);
  return { allowed: missing.length === 0, missing };
}

/**
 * A publish-ready export requires every publish gate *in addition to* the
 * stage prerequisites. Returning the reasons, rather than a bare boolean, is
 * what lets the UI tell the user exactly what is still outstanding.
 */
export function canExportPublishReady(passed: ReadonlySet<WorkflowGate>): {
  allowed: boolean;
  missing: WorkflowGate[];
  missingLabelsNl: string[];
} {
  const missing = missingGates(passed, PUBLISH_READY_GATES);
  return {
    allowed: missing.length === 0,
    missing,
    missingLabelsNl: missing.map((gate) => GATE_LABEL_NL[gate]),
  };
}
