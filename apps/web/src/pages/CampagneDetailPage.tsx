import { Link } from 'react-router-dom';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type {
  BriefEditInput,
  Campaign,
  CampaignCalendar,
  CampaignObjective,
  ContentAssetVersion,
  ContentPlan,
  ExportRecord,
  FunnelStage,
  JobSummary,
  LabelSummary,
  Opportunity,
  PersonaVersion,
  PlannableContentPlan,
} from '@c360/contracts';
import {
  CHANNEL_LABEL_NL,
  COURSE_FACT_LABEL_NL,
  FUNNEL_STAGES,
  FUNNEL_STAGE_GUIDANCE_NL,
  FUNNEL_STAGE_LABEL_NL,
  OBJECTIVE_HINT_NL,
  OBJECTIVE_LABEL_NL,
  PRODUCIBLE_CHANNELS,
  PUBLISH_READY_GATES,
  campaignObjective,
  stagesForObjective,
} from '@c360/contracts';
import { Badge, Button, Card, Disclosure, Field, Icon, Notice, Tabs } from '@c360/ui';
import type { FlowItem } from '../components/FlowNavigation.js';
import { paletteOfLabel } from '../shell/LabelTheme.js';
import { FunnelPills } from '../components/FunnelPills.js';
import { CampaignPackagePanel } from '../components/CampaignPackagePanel.js';
import { DisplayBannerStudio } from '../components/DisplayBannerStudio.js';
import { JobWatcher, jobResultString } from '../components/JobWatcher.js';
import { VisualReferencesPanel } from '../components/VisualReferencesPanel.js';
import { ResultsStep } from '../components/ResultsStep.js';
import { PersonaQuestionnaire, questionnaireCount } from '../components/PersonaQuestionnaire.js';
import { PersonaQuestionnaireFill } from '../components/PersonaQuestionnaireFill.js';
import {
  AdvicePanel,
  CellAdvicePanel,
  ChannelPlanGrid,
  MeasurementPlanPanel,
  cellKey,
  parseCellKey,
  rendersImage,
} from '../components/ChannelPlanGrid.js';
import {
  useBrand,
  useCampaign,
  useCampaignAction,
  useJobProgress,
  usePersonas,
  useOpportunitySet,
  useProposeOpportunities,
  useProposePersonas,
  useSetStartDate,
  type CampaignDetail,
} from '../api/campaign-queries.js';
import { ErrorState, LoadingState } from '../components/states.js';
import { useQueryClient } from '@tanstack/react-query';
import { campaignKeys, useCourses, usePromotePersona } from '../api/campaign-queries.js';
import { PersonaEditor } from '../components/PersonaEditor.js';
import { AssetTile, ContentAssetCard } from '../components/ContentAssetCard.js';
import { BriefDocument } from '../components/BriefDocument.js';
import { useBreadcrumbs } from '../shell/breadcrumbs.js';
import { jobResultStringArray } from '../components/JobWatcher.js';
import { TERMINAL_JOB_STATUSES, computeCampaignProgress } from '@c360/contracts';
import './campaign-flow.css';
import './radar.css';
import './personas.css';

/**
 * The campaign chain, as one screen with eight numbered steps and one branch.
 *
 * **One numbering source.** The step bar numbers the steps by position and
 * every card takes its number from the same list, so the bar can never say
 * "4. Contentpakket" while the card inside says "5. Kanaalplan" — which is
 * what the previous layout did, with the concept, plan and content cards all
 * living inside one tab called *Social & beelden*.
 *
 * **The chain is the product's order**: Doelgroep → Richting → Briefing →
 * Concept → Kanaalplan → Content & beelden → Export → Resultaten & lessen.
 * The website package is a branch beside it (*Website & interactief*), not a
 * step, because it reads the same briefing and plan but produces something
 * else.
 *
 * **Where the person is** is derived from what exists on the server — an
 * approved brief, a chosen concept, an approved plan — never from a counter
 * the browser keeps; the step shown is written to `?fase=` so a reload, a
 * second tab or a shared link land in the same place. Every step stays
 * reachable; a control is enforced inside the step, never by hiding it.
 *
 * **One primary action per screen.** The purple button is the next thing to
 * do; everything else on the step is secondary. A notice at the top says the
 * same thing in words and jumps there.
 */

type StepId =
  | 'audience'
  | 'direction'
  | 'brief'
  | 'concept'
  | 'plan'
  | 'content'
  | 'export'
  | 'results'
  | 'website';

const STEPS: readonly { id: StepId; label: string }[] = [
  { id: 'audience', label: 'Doelgroep' },
  { id: 'direction', label: 'Richting' },
  { id: 'brief', label: 'Briefing' },
  { id: 'concept', label: 'Concept' },
  { id: 'plan', label: 'Kanaalplan' },
  { id: 'content', label: 'Content & beelden' },
  { id: 'export', label: 'Export' },
  { id: 'results', label: 'Resultaten & lessen' },
];

/** The card number of a step: its 1-based position in the chain. */
function stepNumber(id: StepId): number {
  return STEPS.findIndex((step) => step.id === id) + 1;
}

function isStepId(value: string | null): value is StepId {
  return value !== null && (STEPS.some((step) => step.id === value) || value === 'website');
}

export function CampagneDetailPage(props: { label: LabelSummary | undefined }): ReactNode {
  const { campaignId } = useParams<{ campaignId: string }>();
  const detail = useCampaign(props.label?.id, campaignId);

  if (props.label === undefined) {
    return <Notice tone="warning">Kies eerst een label.</Notice>;
  }
  if (detail.isPending) {
    return <LoadingState label="Campagne wordt geladen" />;
  }
  if (detail.isError) {
    return (
      <ErrorState
        message={detail.error.userMessage}
        requestId={detail.error.requestId}
        onRetry={() => void detail.refetch()}
      />
    );
  }

  return <CampaignChain key={detail.data.campaign.id} label={props.label} detail={detail.data} />;
}

/**
 * What to do now — the one rule in `@c360/contracts` (`computeCampaignProgress`),
 * fed with the detail this page has. The campaigns list feeds the same rule
 * from grouped queries, so both screens name the same next step; the only
 * thing this page knows that the server does not is the unsaved doelgroep
 * choice, which is why `personaCount` comes from local state here.
 */
function nextStepFor(
  detail: CampaignDetail,
  selectedPersonaIds: readonly string[],
): { id: StepId; actionNl: string } {
  const progress = computeCampaignProgress({
    entryMode: detail.campaign.entryMode,
    hasOpportunity: detail.campaign.opportunityId !== null,
    fromRadar: detail.campaign.radarRunId !== null,
    personaCount: selectedPersonaIds.length,
    brief:
      detail.brief === null
        ? null
        : { reviewState: detail.brief.reviewState, approved: detail.briefApproved },
    hasSelectedConcept: detail.selectedConcept !== null,
    plan: detail.plan === null ? null : { reviewState: detail.plan.reviewState },
    assets: {
      total: detail.assets.length,
      approved: detail.assets.filter((asset) => asset.reviewState === 'approved').length,
      needsRereview: detail.assets.filter((asset) => asset.reviewState === 'needs_rereview').length,
    },
    hasExport: detail.exports.some((record) => record.sizeBytes > 0),
    hasOutcomes: detail.hasOutcomes,
    lastActivityAt: detail.campaign.updatedAt,
  });
  return { id: progress.nextStepId, actionNl: progress.nextActionNl };
}

function CampaignChain(props: { label: LabelSummary; detail: CampaignDetail }): ReactNode {
  const { label, detail } = props;
  const labelId = label.id;
  const campaignId = detail.campaign.id;
  const canEdit = label.role !== 'label_viewer';
  const canReview = label.role === 'label_manager' || label.role === 'label_approver';
  const stages = stagesForObjective(detail.campaign.objective ?? 'full_funnel');

  /*
   * Which personas this campaign is being built for.
   *
   * Held here because steps 2 and 3 both need it, and seeded from the brief
   * so reopening a campaign shows what it was built for rather than an empty
   * choice.
   */
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>(
    detail.brief?.personaVersionIds ?? [],
  );

  const next = nextStepFor(detail, selectedPersonaIds);

  /*
   * The step shown lives in the URL, and only there.
   *
   * Reading it and writing it on every change is what makes reload, back and
   * a shared link work. An opened campaign without a parameter lands on the
   * next step — written to the URL once, on mount — and from then on the step
   * moves only when the person moves it. Deriving it from "the next step" on
   * every render was the alternative, and it made the screen jump: ticking the
   * first doelgroep changed what the next step was and the audience panel
   * vanished under the person's cursor. The browser smoke found that by
   * timing out on the second checkbox.
   */
  /* Below 1180px the context column gives up its place to the workspace; this
     is the state that brings it back as a block under the step. */
  const [contextOpen, setContextOpen] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('fase');
  const step: StepId = isStepId(requested) ? requested : next.id;
  const goTo = (id: StepId): void => {
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        params.set('fase', id);
        return params;
      },
      { replace: true },
    );
  };
  useEffect(() => {
    if (!isStepId(requested)) {
      goTo(next.id);
    }
    // Only when the parameter is missing; `next` is intentionally not a
    // dependency, because the step must not follow it after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  const items: FlowItem[] = [
    { id: 'audience', label: 'Doelgroep', done: selectedPersonaIds.length > 0 && detail.brief !== null },
    {
      id: 'direction',
      // A campaign born from a radar scan already has its direction: the
      // insight or card it came from is the direction. The step bar still
      // read `opportunityId`, so those campaigns never ticked step 2 even
      // though the progress rule had been fixed (audit 2026-09-15).
      label: 'Richting',
      done: detail.campaign.opportunityId !== null || (detail.campaign.radarRunId ?? null) !== null,
    },
    {
      id: 'brief',
      label: 'Briefing',
      done: detail.briefApproved,
      attention: detail.brief?.reviewState === 'needs_rereview',
    },
    { id: 'concept', label: 'Concept', done: detail.selectedConcept !== null },
    { id: 'plan', label: 'Kanaalplan', done: detail.plan?.reviewState === 'approved' },
    {
      id: 'content',
      label: 'Content & beelden',
      done: detail.assets.length > 0 && detail.assets.every((asset) => asset.reviewState === 'approved'),
      attention: detail.assets.some((asset) => asset.reviewState === 'needs_rereview'),
    },
    { id: 'export', label: 'Export', done: detail.exports.some((record) => record.sizeBytes > 0) },
    { id: 'results', label: 'Resultaten & lessen' },
    { id: 'website', label: 'Website & interactief', numbered: false },
  ];

  const stepIndex = STEPS.findIndex((entry) => entry.id === step);

  // The top bar's trail: list → this campaign → the step being viewed.
  useBreadcrumbs([
    { label: 'Campagnes', to: '/campagnes' },
    { label: detail.campaign.name, to: `/campagnes/${campaignId}?fase=${next.id}` },
    {
      label:
        step === 'website'
          ? 'Website & interactief'
          : `${String(stepNumber(step))}. ${STEPS.find((entry) => entry.id === step)?.label ?? ''}`,
    },
  ]);

  return (
    <div className="os-flow">
      {/* -------------------------------------------------- the step rail --- */}
      <aside className="os-siderail" aria-label="Campagnestappen">
        <div className="os-siderail__intro">
          <p className="os-eyebrow">{`Campagne · ${ENTRY_MODE_NL[detail.campaign.entryMode]}`}</p>
          <p className="os-siderail__course">{detail.campaign.name}</p>
          <div style={{ marginTop: 7 }}>
            <FunnelPills stages={stages} label="Fasen van deze campagne" />
          </div>
          <p className="os-siderail__note">
            {detail.campaign.objective === null
              ? 'Geen doel vastgelegd'
              : `Doel: ${OBJECTIVE_LABEL_NL[detail.campaign.objective]}`}
          </p>
        </div>

        <div className="os-siderail__group">
          {items
            .filter((entry) => entry.numbered !== false)
            .map((entry, index) => {
              const current = step === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={`os-step${entry.done === true ? ' os-step--done' : ''}`}
                  aria-current={current ? 'step' : undefined}
                  onClick={() => {
                    goTo(entry.id as StepId);
                  }}
                >
                  <span className="os-step__num">{index + 1}</span>
                  <span className="os-step__text">
                    <span className="os-step__label">{entry.label}</span>
                    <span className="os-step__state">{stepStateNl(entry, next.id === entry.id)}</span>
                  </span>
                  <span className="os-step__mark">
                    {entry.done === true && <Icon name="check" size={13} />}
                    {next.id === entry.id && entry.done !== true && (
                      <span className="os-step__dot" aria-hidden="true" />
                    )}
                  </span>
                </button>
              );
            })}
        </div>

        {/* The website branch does not take part in the numbering: it is a
            different production run on the same brief, not a ninth step. */}
        <div className="os-siderail__divider">
          <p className="os-eyebrow os-eyebrow--muted">Naast de keten</p>
          <button
            type="button"
            className="os-branch"
            aria-current={step === 'website' ? 'step' : undefined}
            onClick={() => {
              goTo('website');
            }}
          >
            Website &amp; interactief
          </button>
        </div>
      </aside>

      {/* --------------------------------------------------- the workspace --- */}
      <section className="os-detail">
        <div className="os-page__head">
          <div className="os-page__head-text">
            <div className="c360-row" style={{ gap: 8 }}>
              {step !== 'website' && <span className="os-stepbadge">{stepNumber(step)}</span>}
              <h1>{step === 'website' ? 'Website & interactief' : (STEPS.find((entry) => entry.id === step)?.label ?? '')}</h1>
              {next.id === step && <span className="os-pill os-pill--brand">Nu aan zet</span>}
            </div>
            <p className="c360-page-lead">{STEP_LEAD_NL[step]}</p>
          </div>
          <div className="os-page__actions">
            {detail.aiIsMock && (
              <Badge tone="amber">{`AI-aanbieder: ${detail.aiProvider} — voorbeeldteksten`}</Badge>
            )}
            {/* Below 1180px the context column gives up its place; this button
                brings it back under the workspace instead. */}
            <Button
              variant="secondary"
              className="os-contextbutton"
              aria-expanded={contextOpen}
              onClick={() => {
                setContextOpen((open) => !open);
              }}
            >
              Context
            </Button>
          </div>
        </div>

        {detail.campaign.objective === null && (
          <ObjectiveSetter labelId={labelId} campaignId={campaignId} />
        )}

        {step !== next.id && (
          <div className="next-step" role="status">
            <span>
              <strong>Volgende stap:</strong> {next.actionNl}
            </span>
            <Button
              variant="primary"
              size="sm"
              iconAfter="arrow-right"
              onClick={() => {
                goTo(next.id);
              }}
            >
              {`Naar stap ${String(stepNumber(next.id))}`}
            </Button>
          </div>
        )}

        {(detail.campaign.suppliedBrief ?? detail.campaign.userIdea) && (
          <details>
            <summary>
              {detail.campaign.suppliedBrief
                ? 'Jouw oorspronkelijke briefing — ongewijzigd'
                : 'Jouw oorspronkelijke idee'}
            </summary>
            <p style={{ whiteSpace: 'pre-wrap' }}>
              {detail.campaign.suppliedBrief ?? detail.campaign.userIdea}
            </p>
          </details>
        )}

        <div className="c360-stack">
          <div className="flow-panel" hidden={step !== 'audience'}>
            <PersonaStep
              key={campaignId}
              label={label}
              detail={detail}
              selected={selectedPersonaIds}
              onSelectedChange={setSelectedPersonaIds}
              isNext={next.id === 'audience'}
              onContinue={() => goTo(next.id === 'direction' ? 'direction' : 'brief')}
            />
          </div>
          <div className="flow-panel" hidden={step !== 'direction'}>
            <OpportunityStep
              label={label}
              detail={detail}
              selected={selectedPersonaIds}
              isNext={next.id === 'direction'}
              onContinue={() => goTo('brief')}
            />
          </div>
          <div className="flow-panel" hidden={step !== 'brief'}>
            <BriefStep
              labelId={labelId}
              campaignId={campaignId}
              detail={detail}
              selected={selectedPersonaIds}
              stages={stages}
              isNext={next.id === 'brief'}
              canEdit={canEdit}
            />
          </div>
          <div className="flow-panel" hidden={step !== 'concept'}>
            <ConceptStep labelId={labelId} campaignId={campaignId} detail={detail} isNext={next.id === 'concept'} />
          </div>
          <div className="flow-panel" hidden={step !== 'plan'}>
            <PlanStep labelId={labelId} campaignId={campaignId} detail={detail} stages={stages} isNext={next.id === 'plan'} />
          </div>
          <div className="flow-panel" hidden={step !== 'content'}>
            <ContentStep labelId={labelId} campaignId={campaignId} detail={detail} isNext={next.id === 'content'} />
          </div>
          <div className="flow-panel" hidden={step !== 'export'}>
            <ExportStep labelId={labelId} campaignId={campaignId} detail={detail} isNext={next.id === 'export'} />
          </div>
          <div className="flow-panel" hidden={step !== 'results'}>
            <StepCard step={stepNumber('results')} title="Resultaten & lessen" done={false} next={next.id === 'results'}>
              <ResultsStep labelId={labelId} campaignId={campaignId} detail={detail} stages={stages} canWrite={canEdit} />
            </StepCard>
          </div>
          <div className="flow-panel" hidden={step !== 'website'}>
            <CampaignPackagePanel
              key={campaignId}
              labelId={labelId}
              campaignId={campaignId}
              ready={detail.brief?.reviewState === 'approved' && detail.briefApproved}
              canReview={canReview}
              canEdit={canEdit}
              onSocial={() => goTo('plan')}
            />
            <DisplayBannerStudio labelId={labelId} campaignId={campaignId} canEdit={canEdit} />
          </div>
        </div>

        {step !== 'website' && (
          <div className="c360-row" style={{ justifyContent: 'space-between' }}>
            <span>
              {stepIndex > 0 && (
                <Button variant="secondary" onClick={() => goTo(STEPS[stepIndex - 1]!.id)}>
                  {`← ${String(stepIndex)}. ${STEPS[stepIndex - 1]!.label}`}
                </Button>
              )}
            </span>
            <span>
              {stepIndex >= 0 && stepIndex < STEPS.length - 1 && (
                <Button variant="secondary" onClick={() => goTo(STEPS[stepIndex + 1]!.id)}>
                  {`${String(stepIndex + 2)}. ${STEPS[stepIndex + 1]!.label} →`}
                </Button>
              )}
            </span>
          </div>
        )}
      </section>

      {/* ----------------------------------------------- the context panel --- */}
      <CampaignContext
        label={label}
        detail={detail}
        step={step}
        forced={contextOpen}
        onClose={() => {
          setContextOpen(false);
        }}
      />
    </div>
  );
}

/** What a step's second line says in the rail. */
function stepStateNl(entry: FlowItem, isNext: boolean): string {
  if (entry.attention === true) return 'Vraagt een nieuwe beoordeling';
  if (entry.done === true) return 'Afgerond';
  if (isNext) return 'Nu aan zet';
  return 'Nog niet aan de beurt';
}

/** One sentence per step, so the workspace header says what this step decides. */
const STEP_LEAD_NL: Readonly<Record<StepId, string>> = Object.freeze({
  audience: 'Kies voor wie deze campagne wordt gemaakt. Een persona reist als versie mee, zodat de briefing weet waarop ze rust.',
  direction: 'De creatieve richting: waar de campagne vandaan komt en welke invalshoek ze neemt.',
  brief: 'De briefing legt de boodschap per fase vast, met het bewijs eronder en het buiten kader erbij. Alles daarna rust hierop.',
  concept: 'Kies één concept. Het gekozen concept bepaalt de toon en het beeld van elk stuk dat volgt.',
  plan: 'Welke kanalen, hoeveel stuks en in welke fase. Het plan is wat de contentstap uitvoert.',
  content: 'Eén stuk per gepland vakje, geschreven vanuit de boodschap van die fase. Beoordeel elk item, pas de tekst aan of laat het met een instructie herzien.',
  export: 'Een pakket dat je zo kunt gebruiken: de teksten, de beelden op kanaalmaat, en een leesmij die zegt wat waar hoort.',
  results: 'Leg vast wat er is gepubliceerd en wat je zag. Een goedgekeurde les kleurt elk volgend voorstel van dit label.',
  website: 'De website- en interactieve productie op dezelfde briefing. Deze tak doet niet mee aan de nummering.',
});

/**
 * The context column: what may not be claimed, what the brand requires, which
 * colours this label paints with, which sources sit under this step, and the
 * versions behind it.
 *
 * It is a reading column. Nothing here is edited — the moment context becomes
 * editable it competes with the workspace for the same decision.
 */
function CampaignContext(props: {
  label: LabelSummary;
  detail: CampaignDetail;
  step: StepId;
  forced: boolean;
  onClose: () => void;
}): ReactNode {
  const brand = useBrand(props.label.id);
  const { palette, grounded } = paletteOfLabel(props.label);
  const rules = brand.data?.approved?.rules ?? [];
  const mustNot = rules.filter((rule) => rule.kind === 'must_not');
  const must = rules.filter((rule) => rule.kind === 'must');
  const brief = props.detail.brief;

  return (
    <aside
      className={`os-context${props.forced ? ' os-context--forced' : ''}`}
      aria-label="Context bij deze stap"
    >
      <div className="c360-row" style={{ justifyContent: 'space-between' }}>
        <p className="os-eyebrow os-eyebrow--muted" style={{ margin: 0 }}>
          Context
        </p>
        <button
          type="button"
          className="os-flyout__close"
          style={{ color: 'var(--tx-3)' }}
          aria-label="Contextpaneel sluiten"
          onClick={props.onClose}
        >
          <Icon name="close" size={14} />
        </button>
      </div>

      {/* Buiten kader first: it is the only part of this column that can stop
          something from being published. */}
      <div className="os-note os-note--err">
        <p style={{ margin: '0 0 5px', fontWeight: 700 }}>BUITEN KADER</p>
        {brief === null && mustNot.length === 0 ? (
          <p style={{ margin: 0 }}>
            Nog geen briefing, dus nog geen lijst met wat niet gebruikt mag worden.
          </p>
        ) : (
          <>
            <p style={{ margin: '0 0 6px' }}>Niet gebruiken tot bevestigd:</p>
            <ul style={{ margin: 0, paddingLeft: 15, lineHeight: 1.6 }}>
              {(brief?.offLimits ?? []).map((line, index) => (
                <li key={`off-${String(index)}`}>{line}</li>
              ))}
              {brief === null &&
                mustNot.map((rule, index) => <li key={`rule-${String(index)}`}>{rule.text}</li>)}
            </ul>
          </>
        )}
      </div>

      <div>
        <p className="os-eyebrow os-eyebrow--muted">Merkregels</p>
        {must.length === 0 && mustNot.length === 0 ? (
          <p className="os-limit">Dit label heeft nog geen merkregels vastgelegd.</p>
        ) : (
          <div className="c360-stack" style={{ gap: 5 }}>
            {rules.map((rule, index) => (
              <p key={index} className="os-note os-note--quiet">
                <strong>{rule.kind === 'must' ? 'Moet: ' : 'Mag niet: '}</strong>
                {rule.text}
              </p>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="os-eyebrow os-eyebrow--muted">Merkkleuren van dit label</p>
        <div className="c360-stack" style={{ gap: 5 }}>
          {(
            [
              ['Primair', palette.primary],
              ['Accent', palette.accent],
              ['Inkt', palette.ink],
            ] as const
          ).map(([role, hex]) => (
            <span key={role} className="c360-row" style={{ gap: 8, flexWrap: 'nowrap' }}>
              <span
                aria-hidden="true"
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 'var(--radius-xs)',
                  background: hex,
                  border: '1px solid rgb(24 36 48 / 10%)',
                  flex: 'none',
                }}
              />
              <span style={{ flex: 1, fontSize: 11.5, fontWeight: 600 }}>{role}</span>
              <span className="os-num" style={{ fontSize: 10.5, color: 'var(--tx-3)' }}>
                {hex}
              </span>
            </span>
          ))}
        </div>
        {!grounded && (
          <p className="os-limit" style={{ marginTop: 6 }}>
            Dit label heeft geen goedgekeurd merkprofiel; dit is het Certify360-huispalet.
          </p>
        )}
      </div>

      <div>
        <p className="os-eyebrow os-eyebrow--muted">Bronnen onder deze stap</p>
        {brief === null || brief.evidence.length === 0 ? (
          <p className="os-limit">
            Nog geen bronnen: die komen uit de briefing, en die is nog niet geschreven.
          </p>
        ) : (
          <div className="c360-stack" style={{ gap: 6 }}>
            {brief.evidence.slice(0, 8).map((item, index) => (
              <div key={index} className="os-quote">
                <p className="os-quote__text">{item.claim}</p>
                <p className="os-rowcard__meta" style={{ marginTop: 2 }}>
                  {item.sourceRef}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="os-eyebrow os-eyebrow--muted">Versies</p>
        <div className="c360-stack" style={{ gap: 0 }}>
          <VersionLine version={brief === null ? null : `v${String(brief.version)}`} what="Briefing" />
          <VersionLine
            version={
              props.detail.selectedConcept === null
                ? null
                : `v${String(props.detail.selectedConcept.version)}`
            }
            what="Gekozen concept"
          />
          <VersionLine
            version={props.detail.plan === null ? null : `v${String(props.detail.plan.version)}`}
            what="Kanaalplan"
          />
          <VersionLine
            version={props.detail.assets.length === 0 ? null : `${String(props.detail.assets.length)} stuks`}
            what="Content"
          />
          <VersionLine
            version={props.detail.exports.length === 0 ? null : `${String(props.detail.exports.length)} export(s)`}
            what="Export"
          />
        </div>
      </div>
    </aside>
  );
}

function VersionLine(props: { version: string | null; what: string }): ReactNode {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '6px 0', borderTop: '1px solid var(--n-2)' }}>
      <span
        className="os-num"
        style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--lp-deep)', flex: 'none', minWidth: '4.5rem' }}
      >
        {props.version ?? '—'}
      </span>
      <span style={{ flex: 1, fontSize: 11.5, color: 'var(--tx-2)', lineHeight: 1.4 }}>{props.what}</span>
    </div>
  );
}

// ------------------------------------------------------------------- steps ---

/**
 * One step's card. The number comes from the chain, the status from the
 * server's state: *Afgerond* when the step's artefact exists and is approved
 * or chosen, *Nu aan zet* when this is the next thing to do, *Nog niet
 * mogelijk* with the reason while a control upstream is still open.
 */
function StepCard(props: {
  step: number;
  title: string;
  done: boolean;
  next: boolean;
  blocked?: string | undefined;
  children: ReactNode;
}): ReactNode {
  return (
    <Card ariaLabel={`Stap ${String(props.step)}: ${props.title}`} tone={props.next && !props.done ? 'accent' : 'default'}>
      <div className="step-card__head">
        <h2 className="c360-card__title step-card__title" style={{ margin: 0 }}>
          <span className="step-card__number" aria-hidden="true">
            {String(props.step)}
          </span>
          <span className="c360-visually-hidden">{`${String(props.step)}. `}</span>
          {props.title}
        </h2>
        {props.done ? (
          <Badge tone="green">Afgerond</Badge>
        ) : props.blocked !== undefined ? (
          <Badge tone="neutral">Nog niet mogelijk</Badge>
        ) : props.next ? (
          <Badge tone="purple">Nu aan zet</Badge>
        ) : (
          <Badge tone="neutral">Open</Badge>
        )}
      </div>
      <div style={{ marginTop: 'var(--c360-space-4)' }}>
        {props.blocked !== undefined ? <p className="c360-card__hint">{props.blocked}</p> : props.children}
      </div>
    </Card>
  );
}

const MAX_PERSONAS = 3;

function PersonaStep(props: {
  label: LabelSummary;
  detail: CampaignDetail;
  selected: readonly string[];
  onSelectedChange: (next: string[]) => void;
  isNext: boolean;
  onContinue: () => void;
}): ReactNode {
  const { label, detail, selected, onSelectedChange } = props;
  const courseVersionId = detail.campaign.courseVersionId;
  const campaignId = detail.campaign.id;
  const personas = usePersonas(label.id, courseVersionId, campaignId);
  const library = usePersonas(label.id, courseVersionId);
  const propose = useProposePersonas(label.id);
  const promote = usePromotePersona(label.id);
  const courses = useCourses(label.id);
  const courseName =
    courses.data?.items.find((item) => item.course.id === courseVersionId)?.course.name ?? 'deze opleiding';
  const client = useQueryClient();
  // Personas are written by editors and managers; an approver reviews briefs.
  const canWrite = label.role === 'label_manager' || label.role === 'label_editor';

  const tracked = useJobProgress(label.id, campaignId, propose.data?.id);
  const job = tracked.data ?? propose.data;
  const running = job !== undefined && !TERMINAL_JOB_STATUSES.includes(job.status);
  const shortfall = jobResultString(job, 'shortfallReasonNl');
  // What the research could and could not answer in the 36 questions, per
  // persona — the honest account next to the "n/36 personavragen" badge.
  const questionnaireNote = jobResultString(job, 'questionnaireNoteNl');
  // The ids the last run created; an empty list is the run saying "nothing
  // new", a null is a run that has not finished (or never ran).
  const createdIds = job?.status === 'succeeded' ? jobResultStringArray(job, 'personaIds') : null;
  const created = new Set(createdIds ?? []);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /*
   * One row per persona, in the order a person needs them: what the last run
   * added, then this campaign's own, then the library, then versions the
   * briefing still pins but which have a newer version — kept visible so a
   * chosen doelgroep never disappears from under the checkbox.
   */
  const campaignItems = personas.data?.items ?? [];
  const libraryItems = library.data?.items ?? [];
  const known = new Set([...campaignItems, ...libraryItems].map((persona) => persona.id));
  const pinnedStale = detail.personas.filter((persona) => !known.has(persona.id));
  const items = [
    ...campaignItems.filter((persona) => created.has(persona.id)),
    ...campaignItems.filter((persona) => !created.has(persona.id)),
    ...libraryItems,
    ...pinnedStale,
  ];
  const done = detail.brief !== null;
  const full = selected.length >= MAX_PERSONAS;

  const toggle = (id: string): void => {
    onSelectedChange(
      selected.includes(id)
        ? selected.filter((value) => value !== id)
        : [...selected, id].slice(0, MAX_PERSONAS),
    );
  };

  const kindOf = (persona: PersonaVersion): 'new' | 'campaign' | 'library' | 'pinned' =>
    created.has(persona.id)
      ? 'new'
      : persona.campaignId === campaignId
        ? 'campaign'
        : persona.campaignId === null && known.has(persona.id)
          ? 'library'
          : 'pinned';

  return (
    <StepCard step={stepNumber('audience')} title="Doelgroepen voor deze campagne" done={done} next={props.isNext}>
      <p className="c360-card__hint">
        Kies voor wie deze campagne is: laat doelgroepen voorstellen uit het onderzoek, of kies uit de
        bibliotheek van deze opleiding.{' '}
        <Link to={`/beheer/doelgroepen?course=${courseVersionId}`}>Zelf een persona maken of importeren</Link>
      </p>
      <Disclosure summary="Hoe werkt deze stap?">
        <p>
          Voorstellen combineren je campagnebriefing of idee met de opleiding, de merkregels en het
          onderzoek. Elke doelgroep laat zien wat op bewijs rust en wat een aanname is, ook waar en
          wanneer zij zich oriënteert, want daar rust het kanaaladvies op. Een nieuwe ronde voegt
          doelgroepen toe die wezenlijk verschillen van wat er al staat; bestaande blijven staan.
        </p>
        <p>
          Nieuwe voorstellen vullen ook de 36 personavragen in met de beschikbare onderzoeksbevindingen,
          opleidingsinformatie en campagne-invoer. Aannames en ontbrekende informatie blijven zichtbaar;
          een ingevuld antwoord is nog geen bewezen doelgroepgedrag. Met <strong>Bewerken</strong> maak je
          een nieuwe versie; met <strong>Opslaan in bibliotheek</strong> bewaar je een campagnevoorstel
          voor volgende campagnes.
        </p>
      </Disclosure>
      {(library.error ?? personas.error ?? promote.error) && (
        <Notice tone="warning">{(library.error ?? personas.error ?? promote.error)?.userMessage}</Notice>
      )}
      <div className="step-actions">
        <Button
          variant={items.length === 0 ? 'primary' : 'secondary'}
          disabled={propose.isPending || running}
          busy={propose.isPending || running}
          onClick={() => {
            setNotice(null);
            propose.mutate({ courseVersionId, campaignId });
          }}
        >
          {items.length === 0 ? 'Doelgroepen voorstellen' : 'Nieuwe doelgroepen voorstellen'}
        </Button>
        {propose.isError && (
          <span className="c360-field__error" role="alert">
            {propose.error.userMessage}
          </span>
        )}
      </div>

      <JobWatcher
        labelId={label.id}
        campaignId={campaignId}
        job={propose.data}
        onRetry={() => {
          propose.mutate({ courseVersionId, campaignId });
        }}
      />

      {createdIds !== null && createdIds.length === 0 && (
        <Notice tone="warning" live>
          <strong>Er zijn geen nieuwe doelgroepen bijgekomen.</strong>
          {shortfall !== null && ` ${shortfall}`}
          {shortfall === null &&
            ' Het onderzoek leverde geen doelgroep op die wezenlijk verschilt van wat er al staat.'}
        </Notice>
      )}
      {createdIds !== null && createdIds.length > 0 && shortfall !== null && (
        <Notice tone="warning" live>
          {shortfall}
        </Notice>
      )}
      {questionnaireNote !== null && (
        <Notice tone="neutral" live>
          <strong>Vragenlijst uit het onderzoek.</strong>
          <p style={{ whiteSpace: 'pre-wrap', margin: 'var(--c360-space-2) 0 0' }}>{questionnaireNote}</p>
        </Notice>
      )}
      {notice !== null && (
        <Notice tone="info" live>
          {notice}
        </Notice>
      )}

      {items.length > 0 && (
        <fieldset className="c360-fieldset" style={{ marginTop: 'var(--c360-space-4)' }}>
          <legend>Kies maximaal drie doelgroepen</legend>
          <p className="c360-fieldset__help">
            {full
              ? 'Drie gekozen — het maximum. Vink er een uit om een andere te kiezen.'
              : `${String(selected.length)} van ${String(MAX_PERSONAS)} gekozen.`}
          </p>
          <ul className="c360-list">
            {items.map((persona) => {
              const checked = selected.includes(persona.id);
              const kind = kindOf(persona);
              return (
                <li className="c360-list__item" key={persona.id}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <label className="c360-row" style={{ gap: 'var(--c360-space-2)' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!checked && full}
                        onChange={() => {
                          toggle(persona.id);
                        }}
                        aria-label={`Kies doelgroep ${persona.name}`}
                      />
                      <span className="c360-list__title">{`${persona.name} · v${String(persona.version)}`}</span>
                      {kind === 'new' && <Badge tone="purple">Nieuw</Badge>}
                      {kind === 'campaign' && <Badge tone="neutral">Deze campagne</Badge>}
                      {kind === 'library' && <Badge tone="neutral">Bibliotheek</Badge>}
                      {kind === 'pinned' && <Badge tone="amber">Vastgelegd in briefing · oudere versie</Badge>}
                    </label>
                    <p className="c360-list__subtitle">{persona.summary}</p>
                    <PersonaEvidence persona={persona} />
                    {canWrite && (
                      <div className="c360-row" style={{ marginTop: 'var(--c360-space-2)' }}>
                        <Button
                          variant="secondary"
                          aria-expanded={editingId === persona.id}
                          onClick={() => {
                            setNotice(null);
                            setEditingId(editingId === persona.id ? null : persona.id);
                          }}
                        >
                          {editingId === persona.id ? 'Bewerken sluiten' : 'Bewerken'}
                        </Button>
                        {persona.campaignId !== null && (
                          <Button
                            variant="ghost"
                            disabled={promote.isPending}
                            onClick={() => {
                              promote.mutate(
                                { personaVersionId: persona.id },
                                {
                                  onSuccess: (copy) => {
                                    setNotice(
                                      `${copy.name} staat nu ook in de bibliotheek van deze opleiding en is te kiezen in volgende campagnes.`,
                                    );
                                  },
                                },
                              );
                            }}
                          >
                            Opslaan in bibliotheek
                          </Button>
                        )}
                      </div>
                    )}
                    {canWrite && (
                      <PersonaQuestionnaireFill
                        labelId={label.id}
                        campaignId={campaignId}
                        persona={persona}
                        size="md"
                        onFilled={(newId) => {
                          // The choice follows the new version, as it does after Bewerken.
                          onSelectedChange(selected.map((id) => (id === persona.id ? newId : id)));
                          void client.invalidateQueries({ queryKey: campaignKeys.campaign(label.id, campaignId) });
                        }}
                      />
                    )}
                    {editingId === persona.id && (
                      <div style={{ marginTop: 'var(--c360-space-3)' }}>
                        <PersonaEditor
                          key={persona.id}
                          labelId={label.id}
                          courseId={courseVersionId}
                          courseName={courseName}
                          existing={persona}
                          hintNl={
                            done
                              ? 'Opslaan maakt een nieuwe versie van deze doelgroep. De briefing rust op de vorige versie en vraagt daarna om een nieuwe beoordeling in stap 3.'
                              : 'Opslaan maakt een nieuwe versie van deze doelgroep; je keuze volgt de nieuwe versie.'
                          }
                          onSaved={(saved) => {
                            onSelectedChange(selected.map((id) => (id === persona.id ? saved.id : id)));
                            setEditingId(null);
                            setNotice(`${saved.name} is bijgewerkt naar versie ${String(saved.version)}.`);
                            void client.invalidateQueries({ queryKey: campaignKeys.campaign(label.id, campaignId) });
                          }}
                          onCancel={() => {
                            setEditingId(null);
                          }}
                        />
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      {selected.length > 0 && !done && (
        <div className="step-actions">
          <Button variant="primary" onClick={props.onContinue}>
            {detail.campaign.entryMode === 'discover_opportunities' && detail.campaign.opportunityId === null
              ? 'Verder naar 2. Richting'
              : 'Verder naar 3. Briefing'}
          </Button>
          <span className="c360-stat__caption">
            De keuze wordt vastgelegd zodra de briefing wordt uitgewerkt.
          </span>
        </div>
      )}
    </StepCard>
  );
}

/**
 * Everything a persona rests on, in full: the grounding with its source, the
 * assumptions, and where the audience orients — each statement marked
 * *onderbouwd* or *aanname*. Shown, not summarised in a badge count, because
 * the count is exactly what let an ungrounded persona look grounded.
 */
function PersonaEvidence(props: { persona: PersonaVersion }): ReactNode {
  const { persona } = props;
  const grounded = persona.orientationSources.filter((source) => source.grounding !== null).length;
  return (
    <details style={{ marginTop: 'var(--c360-space-2)' }}>
      <summary>
        <Badge tone={persona.grounding.length > 0 ? 'green' : 'neutral'}>
          {`${String(persona.grounding.length)} onderbouwing`}
        </Badge>{' '}
        <Badge tone="amber">{`${String(persona.assumptions.length)} aanname`}</Badge>{' '}
        <Badge tone={grounded > 0 ? 'green' : 'neutral'}>
          {`kanaalgedrag: ${String(grounded)} onderbouwd, ${String(persona.orientationSources.length - grounded)} aanname`}
        </Badge>{' '}
        <Badge tone="neutral">{`${String(questionnaireCount(persona.questionnaire))}/36 personavragen`}</Badge>
      </summary>
      <dl className="c360-definition" style={{ marginTop: 'var(--c360-space-2)' }}>
        <div>
          <dt className="c360-definition__term">Behoefte</dt>
          <dd className="c360-definition__value" style={{ fontWeight: 400 }}>{persona.need}</dd>
        </div>
        <div>
          <dt className="c360-definition__term">Barrières</dt>
          <dd className="c360-definition__value" style={{ fontWeight: 400 }}>{persona.barriers.join(' · ')}</dd>
        </div>
        <div>
          <dt className="c360-definition__term">Besliscriteria</dt>
          <dd className="c360-definition__value" style={{ fontWeight: 400 }}>{persona.decisionCriteria.join(' · ')}</dd>
        </div>
      </dl>
      <p className="c360-list__title" style={{ fontSize: '13px', marginTop: 'var(--c360-space-3)' }}>
        Waar en wanneer oriënteert deze doelgroep zich?
      </p>
      {persona.orientationSources.length === 0 ? (
        <p className="c360-card__hint">
          Geen uitspraken over kanaalgedrag: het kanaaladvies volgt voor deze doelgroep de regel.
        </p>
      ) : (
        <ul className="evidence-list">
          {persona.orientationSources.map((source, index) => (
            <li key={index}>
              {source.statementNl}
              {source.channel !== null && ` (${CHANNEL_LABEL_NL[source.channel]})`}{' '}
              {source.grounding === null ? (
                <Badge tone="amber">aanname</Badge>
              ) : (
                <>
                  <Badge tone="green">onderbouwd</Badge>{' '}
                  <span className="evidence-list__source">{`bron: ${source.grounding.sourceRef}`}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="c360-list__title" style={{ fontSize: '13px', marginTop: 'var(--c360-space-3)' }}>
        Onderbouwing
      </p>
      {persona.grounding.length === 0 ? (
        <p className="c360-card__hint">Geen — deze doelgroep is een hypothese.</p>
      ) : (
        <ul className="evidence-list">
          {persona.grounding.map((item, index) => (
            <li key={index}>
              {item.claim} <span className="evidence-list__source">{`bron: ${item.sourceRef}`}</span>
            </li>
          ))}
        </ul>
      )}
      {persona.assumptions.length > 0 && (
        <>
          <p className="c360-list__title" style={{ fontSize: '13px', marginTop: 'var(--c360-space-3)' }}>
            Aannames
          </p>
          <ul className="evidence-list">
            {persona.assumptions.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </>
      )}
      <h4>De 36 personavragen</h4>
      <PersonaQuestionnaire value={persona.questionnaire} />
    </details>
  );
}

function BriefDraftButton(props: {
  supplied: boolean;
  labelId: string;
  campaignId: string;
  personaVersionIds: string[];
  primary: boolean;
}): ReactNode {
  const draft = useCampaignAction<JobSummary, void>(props.labelId, props.campaignId, () => ({
    path: `/labels/${props.labelId}/campaigns/${props.campaignId}/brief/draft`,
    body: { personaVersionIds: props.personaVersionIds },
  }));

  return (
    <div className="c360-stack" style={{ marginTop: 'var(--c360-space-4)' }}>
      <p className="c360-card__hint">
        {props.supplied
          ? 'Je oorspronkelijke briefing blijft bewaard; het systeem deelt haar in de onderdelen van een campagnebriefing in en toont wat ontbreekt of botst.'
          : 'Uit je uitgangspunt en de gekozen doelgroepen schrijft het systeem een volledige campagnebriefing, die jij daarna goedkeurt.'}
      </p>
      <div className="step-actions">
        <Button
          variant={props.primary ? 'primary' : 'secondary'}
          disabled={draft.isPending}
          busy={draft.isPending}
          onClick={() => {
            draft.mutate();
          }}
        >
          {props.supplied ? 'Mijn briefing structureren en controleren' : 'Briefing uitwerken'}
        </Button>
        {draft.isError && (
          <span className="c360-field__error" role="alert">
            {draft.error.userMessage}
          </span>
        )}
      </div>
      <JobWatcher
        labelId={props.labelId}
        campaignId={props.campaignId}
        job={draft.data}
        onRetry={() => {
          draft.mutate();
        }}
      />
    </div>
  );
}

function OpportunityStep(props: {
  label: LabelSummary;
  detail: CampaignDetail;
  selected: readonly string[];
  isNext: boolean;
  onContinue: () => void;
}): ReactNode {
  const { label, detail, selected } = props;
  const propose = useProposeOpportunities(label.id);
  const attach = useCampaignAction<unknown, { opportunityId: string }>(
    label.id,
    detail.campaign.id,
    ({ opportunityId }) => ({
      path: `/labels/${label.id}/campaigns/${detail.campaign.id}/opportunity`,
      body: { opportunityId },
    }),
  );

  const tracked = useJobProgress(label.id, detail.campaign.id, propose.data?.id);
  const setId = jobResultString(tracked.data ?? propose.data, 'proposalSetId');
  const opportunities = useOpportunitySet(label.id, setId ?? undefined);

  const personaIds = selected.length > 0 ? [...selected] : detail.brief?.personaVersionIds ?? [];
  const done = detail.campaign.opportunityId !== null;
  const optional = detail.campaign.entryMode !== 'discover_opportunities';

  return (
    <StepCard
      step={stepNumber('direction')}
      title="Campagnerichting"
      done={done}
      next={props.isNext}
      blocked={personaIds.length === 0 ? 'Kies eerst een of meer doelgroepen in stap 1.' : undefined}
    >
      <p className="c360-card__hint">
        {optional
          ? 'Je bent gestart vanuit een eigen idee of briefing, dus deze stap is optioneel: laat kansen voorstellen als je je richting wilt toetsen, of ga door naar de briefing.'
          : 'Drie kansen, gerangschikt met een reden — geen score en geen voorspelling. De gekozen kans wordt het uitgangspunt van de briefing.'}
      </p>
      <div className="step-actions">
        <Button
          variant={props.isNext && opportunities.data === undefined ? 'primary' : 'secondary'}
          disabled={propose.isPending}
          busy={propose.isPending}
          onClick={() => {
            propose.mutate({
              courseVersionId: detail.campaign.courseVersionId,
              personaVersionIds: personaIds,
            });
          }}
        >
          Kansen voorstellen
        </Button>
        {optional && !done && (
          <Button onClick={props.onContinue}>Overslaan, naar 3. Briefing</Button>
        )}
        {propose.isError && (
          <span className="c360-field__error" role="alert">
            {propose.error.userMessage}
          </span>
        )}
      </div>

      <JobWatcher
        labelId={label.id}
        campaignId={detail.campaign.id}
        job={propose.data}
        onRetry={() => {
          propose.mutate({
            courseVersionId: detail.campaign.courseVersionId,
            personaVersionIds: personaIds,
          });
        }}
      />

      {attach.error && <Notice tone="warning">{attach.error.userMessage}</Notice>}
      {attach.isSuccess && (
        <Notice tone="info" live>
          De campagnerichting is opgeslagen. Werk nu de briefing uit.
        </Notice>
      )}
      {opportunities.data !== undefined && (
        <ul className="c360-list" style={{ marginTop: 'var(--c360-space-4)' }}>
          {opportunities.data.items.map((opportunity) => (
            <OpportunityRow
              key={opportunity.id}
              opportunity={opportunity}
              onSelect={() => {
                attach.mutate({ opportunityId: opportunity.id }, { onSuccess: () => props.onContinue() });
              }}
              chosen={detail.campaign.opportunityId === opportunity.id}
              busy={attach.isPending}
            />
          ))}
        </ul>
      )}
      {done && (
        <div className="step-actions">
          <Button variant="primary" onClick={props.onContinue}>
            Verder naar 3. Briefing
          </Button>
        </div>
      )}
    </StepCard>
  );
}

function OpportunityRow(props: {
  chosen: boolean;
  opportunity: Opportunity;
  onSelect: () => void;
  busy: boolean;
}): ReactNode {
  const { opportunity } = props;
  return (
    <li className="c360-list__item">
      <div style={{ minWidth: 0 }}>
        <p className="c360-list__title">{`#${String(opportunity.rank)} ${opportunity.title}`}</p>
        <p className="c360-list__subtitle">{opportunity.coreIdea}</p>
        <p className="c360-list__subtitle">
          <strong>Waarom deze positie:</strong> {opportunity.rankRationaleNl}
        </p>
        {opportunity.uncertainties.length > 0 && (
          <p className="c360-list__subtitle">
            <strong>Onzekerheden:</strong> {opportunity.uncertainties.join(' · ')}
          </p>
        )}
        <p className="c360-list__subtitle">
          <strong>Kleine test:</strong> {opportunity.smallTestProposal}
        </p>
      </div>
      <Button onClick={props.onSelect} disabled={props.busy || props.chosen}>
        {props.chosen ? '✓ Gekozen' : 'Kies deze'}
      </Button>
    </li>
  );
}

function BriefStep(props: {
  labelId: string;
  campaignId: string;
  detail: CampaignDetail;
  selected: readonly string[];
  stages: readonly FunnelStage[];
  isNext: boolean;
  canEdit: boolean;
}): ReactNode {
  const { labelId, campaignId, detail, selected, stages, canEdit } = props;
  const brief = detail.brief;
  const courses = useCourses(labelId);
  const briefCourseName =
    courses.data?.items.find((item) => item.course.id === detail.campaign.courseVersionId)?.course.name ?? 'de opleiding';
  const approve = useCampaignAction<unknown, void>(labelId, campaignId, () => ({
    path: `/labels/${labelId}/campaigns/${campaignId}/brief/${String(brief?.id)}/approve`,
    body: {},
  }));
  /*
   * Rewriting one section of the briefing by hand (audit 2026-09-15).
   *
   * The endpoint has existed since the brief did and had no caller: the only
   * way to change a sentence was to regenerate the whole document, which threw
   * away every other correction and cost another model call.
   */
  const editBrief = useCampaignAction<unknown, BriefEditInput>(labelId, campaignId, (patch) => ({
    path: `/labels/${labelId}/campaigns/${campaignId}/brief`,
    body: patch,
    method: 'PATCH',
  }));
  const rereview = brief?.reviewState === 'needs_rereview';

  return (
    <StepCard
      step={stepNumber('brief')}
      title="Briefing"
      done={detail.briefApproved}
      next={props.isNext}
      blocked={
        brief === null && selected.length === 0
          ? 'Kies eerst een of meer doelgroepen in stap 1.'
          : undefined
      }
    >
      {!detail.briefApproved && selected.length > 0 && (
        <BriefDraftButton
          supplied={detail.campaign.entryMode === 'start_from_briefing'}
          labelId={labelId}
          campaignId={campaignId}
          personaVersionIds={[...selected]}
          primary={brief === null}
        />
      )}

      {brief !== null && (
        <>
          {rereview && (
            <Notice tone="warning" live>
              Een van de doelgroepen van deze briefing heeft een nieuwe versie gekregen. Lees de
              briefing opnieuw en keur haar weer goed, of werk haar opnieuw uit met de actuele
              doelgroepen.
            </Notice>
          )}
          {brief.reviewNotes.length > 0 && (
            <Notice tone="warning">
              <strong>Controlepunten en ontbrekende informatie</strong>
              <ul>
                {brief.reviewNotes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </Notice>
          )}
          <BriefDocument
            brief={brief}
            campaignName={detail.campaign.name}
            courseName={briefCourseName}
            personas={detail.personas}
            stages={stages}
            stageMessages={<StageMessagesBlock brief={brief} stages={stages} />}
            editing={
              canEdit
                ? { save: (patch) => editBrief.mutateAsync(patch), busy: editBrief.isPending }
                : undefined
            }
          />

          {!detail.briefApproved && (
            <div className="step-actions">
              <Button
                variant="primary"
                disabled={approve.isPending}
                busy={approve.isPending}
                onClick={() => {
                  approve.mutate();
                }}
              >
                {rereview
                  ? `Briefing v${String(brief.version)} opnieuw goedkeuren`
                  : `Briefing v${String(brief.version)} goedkeuren`}
              </Button>
              <span className="c360-stat__caption">
                Zonder goedkeuring kunnen er geen concepten worden gemaakt.
              </span>
              {approve.isError && (
                <span className="c360-field__error" role="alert">
                  {approve.error.userMessage}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </StepCard>
  );
}

/**
 * The thesis per stage: what the campaign says to a reader in each stage, the
 * kind of call to action, and which confirmed facts it may cite. Shown next to
 * the generic stage guidance so a reviewer can check the one against the other.
 * A brief from before stage messages existed says so, and content is then
 * written from the guidance alone.
 */
function StageMessagesBlock(props: {
  brief: NonNullable<CampaignDetail['brief']>;
  stages: readonly FunnelStage[];
}): ReactNode {
  const { brief, stages } = props;
  if (brief.stageMessages.length === 0) {
    return (
      <p className="c360-card__hint" style={{ marginTop: 'var(--c360-space-3)' }}>
        Deze briefing heeft nog geen boodschap per funnelfase; ze is uitgewerkt voordat dat bestond.
        De content volgt dan de algemene richtlijn per fase. Werk de briefing opnieuw uit om per fase
        een boodschap te krijgen.
      </p>
    );
  }
  return (
    <div style={{ marginTop: 'var(--c360-space-3)' }}>
      <p className="c360-list__title" style={{ fontSize: '14px', margin: 0 }}>
        Boodschap per funnelfase
      </p>
      <p className="c360-card__hint">
        Wat de kernboodschap zegt tegen een lezer in elke fase, met de call to action die bij de fase
        past en de gecontroleerde feiten die de fase mag noemen. De content in stap 6 volgt dit.
      </p>
      <div className="stage-block">
        {stages.map((stage) => {
          const message = brief.stageMessages.find((entry) => entry.stage === stage);
          return (
            <div className="stage-block__item" key={stage}>
              <h4>{FUNNEL_STAGE_LABEL_NL[stage]}</h4>
              <p className="c360-stat__caption">{FUNNEL_STAGE_GUIDANCE_NL[stage].audienceNl}</p>
              {message === undefined ? (
                <p className="c360-card__hint">Geen boodschap voor deze fase in deze briefing.</p>
              ) : (
                <>
                  <p>{message.coreMessageNl}</p>
                  <p>
                    <strong>Call to action:</strong> {message.ctaNl}
                  </p>
                  {message.proofFields.length === 0 ? (
                    <p className="c360-stat__caption">Bewijs: geen opleidingsfeit in deze fase.</p>
                  ) : (
                    <>
                      <p className="c360-stat__caption" style={{ marginBottom: 0 }}>
                        Bewijs dat deze fase mag noemen:
                      </p>
                      <ul className="stage-block__proof">
                        {message.proofFields.map((field) => (
                          <li key={field}>{COURSE_FACT_LABEL_NL[field]}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConceptStep(props: {
  labelId: string;
  campaignId: string;
  detail: CampaignDetail;
  isNext: boolean;
}): ReactNode {
  const { labelId, campaignId, detail } = props;
  const propose = useCampaignAction<JobSummary, void>(labelId, campaignId, () => ({
    path: `/labels/${labelId}/campaigns/${campaignId}/concepts/propose`,
  }));
  const select = useCampaignAction<unknown, { conceptVersionId: string }>(
    labelId,
    campaignId,
    ({ conceptVersionId }) => ({
      path: `/labels/${labelId}/campaigns/${campaignId}/concepts/${conceptVersionId}/select`,
    }),
  );

  return (
    <StepCard
      step={stepNumber('concept')}
      title="Concept & beeldrichting"
      done={detail.selectedConcept !== null}
      next={props.isNext}
      blocked={
        detail.briefApproved
          ? undefined
          : 'Keur eerst de briefing goed in stap 3. Dit is een bewuste controle en kan niet worden overgeslagen.'
      }
    >
      <p className="c360-card__hint">
        Kies de beeldrichting van de campagne: drie verschillende ideeën, elk verbonden aan de
        kernboodschap. De gekozen richting stuurt alle content en beelden.
      </p>
      <Disclosure summary="Hoe werkt deze stap?">
        <p>
          De drie voorstellen verschillen in medium — documentaire fotografie, een conceptueel beeld of
          redactionele illustratie — en in de scène, compositie en behandeling die daarbij horen. Eigen
          beeldreferenties hieronder sturen de voorstellen. Kiezen is een controle: zonder gekozen
          concept wordt er geen kanaalplan en geen content gemaakt.
        </p>
      </Disclosure>
      <VisualReferencesPanel
        labelId={labelId}
        campaignId={campaignId}
        assetIds={detail.campaign.visualReferenceAssetIds ?? []}
      />
      <div className="step-actions">
        <Button
          variant={detail.concepts.length === 0 ? 'primary' : 'secondary'}
          disabled={propose.isPending}
          busy={propose.isPending}
          onClick={() => {
            propose.mutate();
          }}
        >
          Drie beeldrichtingen voorstellen
        </Button>
        {propose.isError && (
          <span className="c360-field__error" role="alert">
            {propose.error.userMessage}
          </span>
        )}
      </div>

      <JobWatcher
        labelId={labelId}
        campaignId={campaignId}
        job={propose.data}
        onRetry={() => {
          propose.mutate();
        }}
      />

      {detail.concepts.length > 0 && (
        <ul className="c360-list" style={{ marginTop: 'var(--c360-space-4)' }}>
          {detail.concepts.map((concept) => (
            <li className="c360-list__item" key={concept.id}>
              <div style={{ minWidth: 0 }}>
                <p className="c360-list__title">
                  {concept.name} {concept.selected && <Badge tone="green">Gekozen</Badge>}
                </p>
                <p className="c360-list__subtitle">{concept.coreIdea}</p>
                <p className="c360-list__subtitle">
                  <strong>Voorbeeldkop:</strong> {concept.exampleHeadline}
                </p>
                <p className="c360-list__subtitle">
                  <strong>Visueel:</strong> {concept.visualApproach}
                </p>
                {concept.artDirection && (
                  <div className="c360-list__subtitle">
                    <Badge tone="neutral">
                      {
                        {
                          documentary: 'Documentaire fotografie',
                          conceptual: 'Conceptueel beeld',
                          illustration: 'Redactionele illustratie',
                        }[concept.artDirection.medium]
                      }
                    </Badge>
                    <p>
                      <strong>Scène:</strong> {concept.artDirection.scene}
                    </p>
                    <p>
                      <strong>Compositie:</strong> {concept.artDirection.composition}
                    </p>
                    <p>
                      <strong>Licht &amp; uitvoering:</strong> {concept.artDirection.lighting} ·{' '}
                      {concept.artDirection.treatment}
                    </p>
                  </div>
                )}
                <p className="c360-list__subtitle">
                  <strong>Past bij de doelgroep:</strong> {concept.personaFitRationaleNl}
                </p>
              </div>
              {!concept.selected && (
                <Button
                  disabled={select.isPending}
                  onClick={() => {
                    select.mutate({ conceptVersionId: concept.id });
                  }}
                >
                  Kies
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {select.isError && (
        <span className="c360-field__error" role="alert">
          {select.error.userMessage}
        </span>
      )}
    </StepCard>
  );
}

/**
 * The calendar: relative until a start date is chosen, sequenced by stage.
 *
 * Shows offsets as "week 1 · dag 1" while no date exists, and real dates once
 * one does. Every slot names its stage, so the order — Ontdekken first,
 * Beslissen last — reads as the journey it is rather than as an arbitrary
 * spread of channels.
 */
function CampaignCalendarPanel(props: {
  labelId: string;
  campaignId: string;
  startDate: string | null;
  calendar: CampaignCalendar;
}): ReactNode {
  const setStartDate = useSetStartDate(props.labelId, props.campaignId);
  const [draft, setDraft] = useState(props.startDate ?? '');
  const inputId = `start-date-${props.campaignId}`;

  return (
    <div className="c360-stack" style={{ marginTop: 'var(--c360-space-4)' }}>
      <p className="c360-list__title" style={{ fontSize: '14px', margin: 0 }}>
        Planning
      </p>
      <div className="c360-row" style={{ alignItems: 'end' }}>
        <Field
          id={inputId}
          label="Startdatum van de campagne"
          hint="Zonder startdatum blijft de planning relatief: Ontdekken in week 1, Overwegen vanaf week 2, Beslissen vanaf week 3."
          error={setStartDate.isError ? setStartDate.error.userMessage : undefined}
        >
          {(fieldProps) => (
            <input
              {...fieldProps}
              className="c360-input"
              type="date"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          )}
        </Field>
        <Button
          disabled={setStartDate.isPending || draft === (props.startDate ?? '')}
          onClick={() => {
            setStartDate.mutate(draft.length === 0 ? null : draft);
          }}
        >
          Datum vastleggen
        </Button>
        {props.startDate !== null && (
          <Button
            disabled={setStartDate.isPending}
            onClick={() => {
              setDraft('');
              setStartDate.mutate(null);
            }}
          >
            Datum weghalen
          </Button>
        )}
      </div>

      {props.calendar.warnings.map((warning) => (
        <Notice key={warning.kind} tone="warning">
          {warning.messageNl}
        </Notice>
      ))}

      {props.calendar.slots.length > 0 && (
        <div className="c360-table-scroll">
          <table className="c360-table">
            <caption className="c360-visually-hidden">
              {props.calendar.isDated ? 'Planning met echte data' : 'Relatieve planning, zonder startdatum'}
            </caption>
            <thead>
              <tr>
                <th scope="col">Wanneer</th>
                <th scope="col">Fase</th>
                <th scope="col">Kanaal</th>
                <th scope="col">Nummer</th>
              </tr>
            </thead>
            <tbody>
              {props.calendar.slots.map((slot) => (
                <tr key={`${slot.stage ?? ''}-${slot.channel}-${String(slot.sequence)}`}>
                  <td>{slot.date ?? `week ${String(slot.week)} · dag ${String((slot.offsetDays % 7) + 1)}`}</td>
                  <td>{slot.stage === null ? '—' : FUNNEL_STAGE_LABEL_NL[slot.stage]}</td>
                  <td>{CHANNEL_LABEL_NL[slot.channel]}</td>
                  <td>{slot.sequence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Sets the objective of a campaign created before objectives existed.
 *
 * Shown only while the objective is null. Once set it cannot be cleared: the
 * plan and the content that follow are argued from it.
 */
function ObjectiveSetter(props: { labelId: string; campaignId: string }): ReactNode {
  const { labelId, campaignId } = props;
  const id = useId();
  const [objective, setObjective] = useState<CampaignObjective | ''>('');
  const set = useCampaignAction<Campaign, { objective: CampaignObjective }>(
    labelId,
    campaignId,
    (input) => ({
      path: `/labels/${labelId}/campaigns/${campaignId}/objective`,
      body: input,
      method: 'PATCH',
    }),
  );

  return (
    <div className="c360-row" style={{ alignItems: 'end', marginTop: 'var(--c360-space-3)' }}>
      <Field
        id={id}
        label="Doel vastleggen"
        hint="Deze campagne is gemaakt voordat doelen bestonden. Het doel bepaalt welke funnelfasen de briefing en het kanaalplan dekken; zonder doel gaan die uit van de hele funnel."
      >
        {(fieldProps) => (
          <select
            {...fieldProps}
            className="c360-select"
            value={objective}
            onChange={(event) => {
              setObjective(event.target.value as CampaignObjective | '');
            }}
          >
            <option value="">Kies een doel…</option>
            {campaignObjective.options.map((option) => (
              <option key={option} value={option}>
                {`${OBJECTIVE_LABEL_NL[option]} — ${OBJECTIVE_HINT_NL[option]}`}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Button
        disabled={objective === '' || set.isPending}
        onClick={() => {
          if (objective !== '') {
            set.mutate({ objective });
          }
        }}
      >
        Doel vastleggen
      </Button>
      {set.isError && (
        <span className="c360-field__error" role="alert">
          {set.error.userMessage}
        </span>
      )}
    </div>
  );
}

function PlanStep(props: {
  labelId: string;
  campaignId: string;
  detail: CampaignDetail;
  stages: readonly FunnelStage[];
  isNext: boolean;
}): ReactNode {
  const { labelId, campaignId, detail, stages } = props;
  const propose = useCampaignAction<JobSummary, void>(labelId, campaignId, () => ({
    path: `/labels/${labelId}/campaigns/${campaignId}/plan/propose`,
  }));

  const plan = detail.plan;
  const approved = plan?.reviewState === 'approved';

  return (
    <StepCard
      step={stepNumber('plan')}
      title="Kanaalplan"
      done={approved}
      next={props.isNext}
      blocked={detail.selectedConcept === null ? 'Kies eerst een concept in stap 4.' : undefined}
    >
      <p className="c360-card__hint">
        Welke kanalen in welke fase, met een reden die je kunt controleren. Je kiest zelf wat er
        gemaakt wordt; het meetplan per fase wordt samen met het plan goedgekeurd.
      </p>
      <Disclosure summary="Hoe werkt deze stap?">
        <p>
          Per funnelfase stelt het systeem kanalen voor: eerst de redactionele regel voor die fase, dan
          de toespitsing op jouw doelgroepen waar daar bewijs voor is uit hun oriëntatiegedrag. Een
          ontraden vakje kun je toch kiezen; het advies blijft er dan naast staan. Het meetplan noemt per
          fase één indicator en waar die wordt afgelezen, zonder streefwaarde of prognose.
        </p>
      </Disclosure>
      {detail.campaign.objective === null && (
        <Notice tone="info">
          Deze campagne heeft geen doel vastgelegd; het plan gaat uit van de hele funnel. Leg bovenaan
          een doel vast om het plan te richten.
        </Notice>
      )}
      <div className="step-actions">
        <Button
          variant={plan === null ? 'primary' : 'secondary'}
          disabled={propose.isPending}
          busy={propose.isPending}
          onClick={() => {
            propose.mutate();
          }}
        >
          {plan === null ? 'Kanaalplan voorstellen' : 'Nieuw kanaalplan voorstellen'}
        </Button>
        {propose.isError && (
          <span className="c360-field__error" role="alert">
            {propose.error.userMessage}
          </span>
        )}
      </div>

      <JobWatcher
        labelId={labelId}
        campaignId={campaignId}
        job={propose.data}
        onRetry={() => {
          propose.mutate();
        }}
      />

      {plan !== null && (
        <PlanEditor
          key={plan.id}
          labelId={labelId}
          campaignId={campaignId}
          detail={detail}
          plan={plan.plan}
          stages={stages}
          approved={approved}
        />
      )}
    </StepCard>
  );
}

/** The cells the proposal planned, as selection keys. Stage-less items have no cell. */
function proposedSelection(plan: ContentPlan): Set<string> {
  const keys = new Set<string>();
  for (const item of plan.items) {
    if (item.stage !== null) {
      keys.add(cellKey(item.stage, item.channel));
    }
  }
  return keys;
}

function sameSelection(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((key) => b.has(key));
}

/**
 * The plan as the person chose it, in stage order then channel order.
 *
 * Items the proposal already had keep their count and image choice; cells the
 * person added get one piece, with an image only where the channel renders
 * one. The advice and the measurement plan travel along unchanged — they are
 * not theirs to edit here, and the approval binds to what they saw.
 */
function editedPlan(
  plan: ContentPlan,
  selection: ReadonlySet<string>,
  stages: readonly FunnelStage[],
): PlannableContentPlan {
  return {
    items: stages.flatMap((stage) =>
      PRODUCIBLE_CHANNELS.filter((channel) => selection.has(cellKey(stage, channel))).map((channel) => {
        const existing = plan.items.find((item) => item.stage === stage && item.channel === channel);
        return {
          stage,
          channel,
          count: existing?.count ?? 1,
          withImage: existing?.withImage ?? rendersImage(channel),
        };
      }),
    ),
    cadenceNl: plan.cadenceNl,
    rationaleNl: plan.rationaleNl,
    channelAdvice: plan.channelAdvice,
    measurementPlan: plan.measurementPlan,
  };
}

function PlanEditor(props: {
  labelId: string;
  campaignId: string;
  detail: CampaignDetail;
  plan: ContentPlan;
  stages: readonly FunnelStage[];
  approved: boolean;
}): ReactNode {
  const { labelId, campaignId, detail, plan, stages, approved } = props;
  const [selection, setSelection] = useState<Set<string>>(() => proposedSelection(plan));
  const [focused, setFocused] = useState<string | null>(null);
  const approve = useCampaignAction<unknown, { edited: PlannableContentPlan | null }>(
    labelId,
    campaignId,
    (input) => ({
      path: `/labels/${labelId}/campaigns/${campaignId}/plan/approve`,
      body: input,
    }),
  );

  const legacy = plan.items.some((item) => item.stage === null);
  const everything = new Set(
    stages.flatMap((stage) => PRODUCIBLE_CHANNELS.map((channel) => cellKey(stage, channel))),
  );
  const changed = !sameSelection(selection, proposedSelection(plan));
  const withImage = [...selection].filter((key) => {
    const cell = parseCellKey(key);
    if (cell === null) {
      return false;
    }
    const existing = plan.items.find((item) => item.stage === cell.stage && item.channel === cell.channel);
    return existing?.withImage ?? rendersImage(cell.channel);
  }).length;

  return (
    <div className="c360-stack" style={{ marginTop: 'var(--c360-space-4)' }}>
      {legacy ? (
        <div className="c360-table-scroll">
          <table className="c360-table">
            <thead>
              <tr>
                <th scope="col">Kanaal</th>
                <th scope="col">Aantal</th>
                <th scope="col">Beeld</th>
              </tr>
            </thead>
            <tbody>
              {plan.items.map((item) => (
                <tr key={`${item.stage ?? ''}/${item.channel}`}>
                  <td>{CHANNEL_LABEL_NL[item.channel]}</td>
                  <td>{item.count}</td>
                  <td>{item.withImage ? 'ja' : 'nee'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <ChannelPlanGrid
            stages={stages}
            plan={plan}
            selection={selection}
            disabled={approved}
            focused={focused}
            onFocusCell={setFocused}
            onToggle={(key, checked) => {
              setSelection((previous) => {
                const next = new Set(previous);
                if (checked) {
                  next.add(key);
                } else {
                  next.delete(key);
                }
                return next;
              });
            }}
          />
          <CellAdvicePanel plan={plan} cell={focused} />
          {!approved && (
            <label className="c360-row" style={{ gap: 'var(--c360-space-2)' }}>
              <input
                type="checkbox"
                checked={sameSelection(selection, everything)}
                onChange={(event) => {
                  setSelection(event.target.checked ? new Set(everything) : proposedSelection(plan));
                }}
              />
              <span>
                <strong>Alle creatives maken</strong>
                <span className="c360-stat__caption">
                  {' '}
                  — elk kanaal in elke fase, ook waar het advies ontraadt. Het advies blijft ernaast
                  staan.
                </span>
              </span>
            </label>
          )}
          <p className="c360-list__subtitle plan-estimate">
            <span>
              <strong>Omvang:</strong>
              {` ${String(selection.size)} items`}
              {withImage > 0 ? `, waarvan ${String(withImage)} met beeld (twee ontwerpvarianten elk)` : ''}.
            </span>
            <span className="c360-stat__caption">
              Schatting van de omvang. Het budget wordt per taak gereserveerd zodra de content wordt
              gemaakt.
            </span>
          </p>
          {selection.size === 0 && (
            <p className="c360-field__error" role="alert">
              Kies minstens één vakje.
            </p>
          )}
          <details>
            <summary>Waarom dit advies — alle vakjes</summary>
            <AdvicePanel stages={stages} plan={plan} />
          </details>
          <MeasurementPlanPanel stages={stages} plan={plan} />
        </>
      )}

      <p className="c360-list__subtitle">
        <strong>Frequentie:</strong> {plan.cadenceNl}
      </p>
      <p className="c360-list__subtitle">{plan.rationaleNl}</p>

      <CampaignCalendarPanel
        labelId={labelId}
        campaignId={campaignId}
        startDate={detail.campaign.startDate}
        calendar={detail.calendar}
      />

      {!approved && (
        <div className="step-actions">
          <Button
            variant="primary"
            disabled={approve.isPending || (!legacy && selection.size === 0)}
            busy={approve.isPending}
            onClick={() => {
              approve.mutate({
                edited: !legacy && changed ? editedPlan(plan, selection, stages) : null,
              });
            }}
          >
            {changed ? 'Kanaalplan met mijn keuze goedkeuren' : 'Kanaalplan goedkeuren'}
          </Button>
          <span className="c360-stat__caption">
            Goedkeuren legt het plan én het meetplan vast; daarna wordt de content gemaakt.
          </span>
          {approve.isError && (
            <span className="c360-field__error" role="alert">
              {approve.error.userMessage}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function ContentStep(props: {
  labelId: string;
  campaignId: string;
  detail: CampaignDetail;
  isNext: boolean;
}): ReactNode {
  const { labelId, campaignId, detail } = props;
  const generate = useCampaignAction<JobSummary, void>(labelId, campaignId, () => ({
    path: `/labels/${labelId}/campaigns/${campaignId}/content/generate`,
  }));

  const planApproved = detail.plan?.reviewState === 'approved';
  const unapproved = detail.assets.filter((asset) => asset.reviewState !== 'approved').length;

  /*
   * One stage at a time, or all of them.
   *
   * Three stages of four channels each is twelve long cards in a column, so a
   * tab per stage keeps the reviewer's eye on one message. But somebody who
   * just made a whole funnel wants to see the whole funnel, and reading the
   * three stage messages next to each other is how you notice that two of them
   * say the same thing. So "Alles" is the first tab and the one it opens on;
   * narrowing to one stage is then a choice rather than the only option
   * (2026-09-16).
   *
   * Showing everything is not as heavy as it sounds: each stage still opens one
   * card at a time under its own tiles, so "Alles" is three cards, not twelve.
   */
  const groups = groupAssetsByStage(detail.assets).map((group) => ({ ...group, key: group.stage ?? 'none' }));
  const ALL_STAGES = 'all';
  const [stageTab, setStageTab] = useState<string>(ALL_STAGES);
  const showingAll = stageTab === ALL_STAGES;
  const activeGroup = showingAll
    ? undefined
    : (groups.find((group) => group.key === stageTab) ?? groups[0]);
  /*
   * Which piece the reviewer is reading, per stage.
   *
   * The tiles are the overview; one card opens underneath. Keyed by stage so
   * switching stage does not throw away where you were in the other one.
   */
  const [openAsset, setOpenAsset] = useState<Record<string, string>>({});

  return (
    <StepCard
      step={stepNumber('content')}
      title="Content & beelden"
      done={detail.assets.length > 0 && unapproved === 0}
      next={props.isNext}
      blocked={planApproved ? undefined : 'Keur eerst het kanaalplan goed in stap 5.'}
    >
      <p className="c360-card__hint">
        Eén stuk per gepland vakje, geschreven vanuit de boodschap van die fase. Beoordeel elk item, pas
        de tekst aan of laat het met een instructie herzien.
      </p>
      <Disclosure summary="Hoe werkt deze stap?">
        <p>
          Elke fase krijgt een eigen opening en beantwoordt een andere vraag van de lezer; de
          kernboodschap blijft gelijk. Een pagina of e-mail die te kort is, een bericht zonder hashtags
          of een stuk dat een ander stuk herhaalt wordt door het systeem teruggestuurd voordat het hier
          verschijnt. Twee ontwerpvarianten dragen dezelfde boodschap en call to action. Goedkeuren
          gebeurt per item; pas daarna kan er worden geëxporteerd.
        </p>
      </Disclosure>
      <div className="step-actions">
        <Button
          variant={detail.assets.length === 0 ? 'primary' : 'secondary'}
          disabled={generate.isPending}
          busy={generate.isPending}
          onClick={() => {
            generate.mutate();
          }}
        >
          {detail.assets.length === 0 ? 'Content maken' : 'Content opnieuw maken'}
        </Button>
        {detail.assets.length > 0 && (
          <span className="c360-stat__caption">
            {unapproved === 0
              ? 'Alle items zijn goedgekeurd.'
              : `${String(unapproved)} van ${String(detail.assets.length)} items wacht op beoordeling.`}
          </span>
        )}
        {generate.isError && (
          <span className="c360-field__error" role="alert">
            {generate.error.userMessage}
          </span>
        )}
      </div>

      <JobWatcher
        labelId={labelId}
        campaignId={campaignId}
        job={generate.data}
        onRetry={() => {
          generate.mutate();
        }}
      />

      {groups.length > 0 && (
        <div className="c360-stack" style={{ marginTop: 'var(--c360-space-5)' }}>
          {groups.length > 1 && (
            <Tabs
              label="Content per funnelfase"
              value={showingAll ? ALL_STAGES : (activeGroup?.key ?? '')}
              onChange={setStageTab}
              items={[
                {
                  id: ALL_STAGES,
                  label: 'Alles',
                  count: detail.assets.length,
                  attention: detail.assets.some((asset) => asset.reviewState === 'needs_rereview'),
                },
                ...groups.map((group) => ({
                  id: group.key,
                  label: group.stage === null ? 'Zonder fase' : FUNNEL_STAGE_LABEL_NL[group.stage],
                  count: group.assets.length,
                  attention: group.assets.some((asset) => asset.reviewState === 'needs_rereview'),
                })),
              ]}
            />
          )}
          {/*
            Every stage stays mounted and the ones not on show are hidden, so a
            reviewer's half-typed edit survives a tab switch and the e-mail
            previews of every stage load once.

            One panel around all of them rather than one per stage: with "Alles"
            selected several stages are visible at once, and several elements
            each claiming to be *the* panel of one tab is not what a tablist
            means.
          */}
          <div
            className="c360-stack"
            role={groups.length > 1 ? 'tabpanel' : undefined}
            aria-label={showingAll ? 'Alle funnelfasen' : undefined}
          >
          {groups.map((group) => (
            <div
              key={group.key}
              className="c360-stack"
              hidden={!showingAll && activeGroup !== undefined && group.key !== activeGroup.key}
            >
              {group.stage !== null && (
                <div className="stage-heading">
                  <h3 className="c360-card__title" style={{ margin: 0 }}>
                    {FUNNEL_STAGE_LABEL_NL[group.stage]}
                  </h3>
                  <span className="c360-stat__caption">
                    {detail.brief?.stageMessages.find((message) => message.stage === group.stage)?.coreMessageNl ??
                      FUNNEL_STAGE_GUIDANCE_NL[group.stage].messageNl}
                  </span>
                </div>
              )}
              {(() => {
                const selectedId = openAsset[group.key] ?? group.assets[0]?.id;
                return (
                  <>
                    {group.assets.length > 1 && (
                      <div className="asset-grid" role="group" aria-label="Gemaakte content in deze fase">
                        {group.assets.map((asset) => (
                          <AssetTile
                            key={asset.id}
                            asset={asset}
                            selected={asset.id === selectedId}
                            onSelect={() => {
                              setOpenAsset((current) => ({ ...current, [group.key]: asset.id }));
                            }}
                          />
                        ))}
                      </div>
                    )}
                    {/*
                      Every card stays mounted and the ones you are not reading
                      are hidden, so an edit in progress and a loaded e-mail
                      preview survive switching between pieces.
                    */}
                    {group.assets.map((asset) => (
                      <div key={asset.id} hidden={group.assets.length > 1 && asset.id !== selectedId}>
                        <ContentAssetCard labelId={labelId} campaignId={campaignId} asset={asset} />
                      </div>
                    ))}
                  </>
                );
              })()}
            </div>
          ))}
          </div>
        </div>
      )}
    </StepCard>
  );
}

/** Assets by stage in journey order, stage-less content last; empty groups omitted. */
function groupAssetsByStage(
  assets: readonly ContentAssetVersion[],
): { stage: FunnelStage | null; assets: ContentAssetVersion[] }[] {
  const order: (FunnelStage | null)[] = [...FUNNEL_STAGES, null];
  return order
    .map((stage) => ({ stage, assets: assets.filter((asset) => asset.funnelStage === stage) }))
    .filter((group) => group.assets.length > 0);
}

function ExportStep(props: {
  labelId: string;
  campaignId: string;
  detail: CampaignDetail;
  isNext: boolean;
}): ReactNode {
  const { labelId, campaignId, detail } = props;
  const { gates } = detail;
  /*
   * Only the gates this export actually evaluates.
   *
   * The list used to walk every label in the vocabulary, so five gates that
   * `evaluateGates` never fills — doelgroepen, kans, briefing, concept,
   * kanaalplan — read "open" on a finished campaign for ever (audit
   * 2026-09-15). Those five are enforced earlier in the chain, each by its own
   * step, and repeating them here as permanently open was simply wrong.
   */
  const allGates = PUBLISH_READY_GATES.filter((gate) => gate in gates.labels);
  const ready = gates.blockedReasonsNl.length === 0;
  const draft = useCampaignAction<{ export: ExportRecord; ready: boolean }, void>(labelId, campaignId, () => ({
    path: `/labels/${labelId}/campaigns/${campaignId}/exports`,
    body: { kind: 'draft' },
  }));
  const publishReady = useCampaignAction<{ export: ExportRecord; ready: boolean }, void>(
    labelId,
    campaignId,
    () => ({
      path: `/labels/${labelId}/campaigns/${campaignId}/exports`,
      body: { kind: 'publish_ready' },
    }),
  );

  return (
    <StepCard
      step={stepNumber('export')}
      title="Export"
      done={detail.exports.some((record) => record.sizeBytes > 0)}
      next={props.isNext}
      blocked={detail.assets.length === 0 ? 'Maak eerst content in stap 6.' : undefined}
    >
      <p className="c360-card__hint">
        Een conceptpakket kan altijd; een publicatieklaar pakket alleen als elke controle hieronder op
        ok staat.
      </p>
      <Disclosure summary="Wat zit er in een pakket?">
        <p>
          Beide pakketten bevatten de content per fase als tekst, de beelden en het publicatieplan. Een
          publicatieklaar pakket wordt geweigerd met de redenen zolang een controle open staat: een
          niet-goedgekeurd item, een niet-gecontroleerd opleidingsfeit of een kanaal waarvan de
          specificaties niet zijn geverifieerd. Dit systeem publiceert niets zelf.
        </p>
      </Disclosure>

      <ul className="c360-list" style={{ marginTop: 'var(--c360-space-3)' }}>
        {allGates.map((gate) => (
          <li key={gate} className="c360-list__item" style={{ padding: 'var(--c360-space-2) 0', border: 'none' }}>
            <span className="c360-list__subtitle" style={{ margin: 0 }}>
              {gates.labels[gate]}
            </span>
            <Badge tone={gates.passed.includes(gate) ? 'green' : 'neutral'}>
              {gates.passed.includes(gate) ? 'ok' : 'open'}
            </Badge>
          </li>
        ))}
      </ul>
      {gates.blockedReasonsNl.length > 0 && (
        <Notice tone="warning">
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {gates.blockedReasonsNl.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        </Notice>
      )}

      <div className="step-actions">
        <Button
          variant={ready ? 'secondary' : 'primary'}
          disabled={draft.isPending}
          busy={draft.isPending}
          onClick={() => {
            draft.mutate();
          }}
        >
          Concept exporteren
        </Button>
        <Button
          variant={ready ? 'primary' : 'secondary'}
          disabled={publishReady.isPending}
          busy={publishReady.isPending}
          title={ready ? undefined : 'Wordt geweigerd tot alle controles op ok staan; de redenen worden getoond.'}
          onClick={() => {
            publishReady.mutate();
          }}
        >
          Publicatieklaar
        </Button>
      </div>

      {draft.isError && (
        <Notice tone="warning" live>
          {draft.error.userMessage}
        </Notice>
      )}
      {publishReady.isError && (
        <Notice tone="warning" live>
          {publishReady.error.userMessage}
        </Notice>
      )}

      {detail.exports.length > 0 && (
        <ul className="c360-list" style={{ marginTop: 'var(--c360-space-4)' }}>
          {detail.exports.slice(0, 5).map((record) => (
            <li className="c360-list__item" key={record.id}>
              <div style={{ minWidth: 0 }}>
                <p className="c360-list__title" style={{ fontSize: '13px' }}>
                  {record.kind === 'draft' ? 'Concept' : 'Publicatieklaar'}
                  {record.blockedReasonsNl.length > 0 && ' · geweigerd'}
                </p>
                <p className="c360-list__subtitle">
                  {record.blockedReasonsNl.length > 0
                    ? record.blockedReasonsNl.join(' · ')
                    : `${String(record.manifest.length)} bestanden · ${formatBytes(record.sizeBytes)}`}
                </p>
              </div>
              {record.sizeBytes > 0 && (
                <a className="c360-button c360-button--secondary" href={`/api/v1/labels/${labelId}/exports/${record.id}/file`}>
                  Download
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </StepCard>
  );
}

function formatBytes(bytes: number): string {
  return bytes > 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${String(Math.max(1, Math.round(bytes / 1024)))} kB`;
}

// Noun forms: these describe a campaign's starting point in a header, not a
// choice the reader is about to make.
const ENTRY_MODE_NL: Record<Campaign['entryMode'], string> = {
  discover_opportunities: 'Startpunt: voorstellen van het systeem',
  develop_my_idea: 'Startpunt: eigen idee',
  start_from_briefing: 'Startpunt: bestaande briefing',
};

