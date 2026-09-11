import { FlowNavigation } from '../components/FlowNavigation.js';
import { CampaignPackagePanel } from '../components/CampaignPackagePanel.js';
import './radar.css';
import { JobWatcher, jobResultString } from '../components/JobWatcher.js';
import { VisualReferencesPanel } from '../components/VisualReferencesPanel.js';
import { useId, useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type {
  Campaign,
  CampaignCalendar,
  CampaignObjective,
  ContentAssetVersion,
  ContentPlan,
  ExportRecord,
  FunnelStage,
  LabelSummary,
  Opportunity,
  PersonaVersion,
  PlannableContentPlan,
} from '@c360/contracts';
import {
  CHANNEL_LABEL_NL,
  FUNNEL_STAGES,
  FUNNEL_STAGE_GUIDANCE_NL,
  FUNNEL_STAGE_LABEL_NL,
  OBJECTIVE_HINT_NL,
  OBJECTIVE_LABEL_NL,
  PRODUCIBLE_CHANNELS,
  campaignObjective,
  stagesForObjective,
} from '@c360/contracts';
import {
  AdvicePanel,
  ChannelPlanGrid,
  cellKey,
  parseCellKey,
  rendersImage,
} from '../components/ChannelPlanGrid.js';
import './campaign-flow.css';
import type { JobSummary } from '@c360/contracts';
import { Badge, Button, Card, Field, Notice } from '@c360/ui';
import {
  assetImageUrl,
  useCampaign,
  useCampaignAction,
  useEditContent,
  useJobProgress,
  usePersonas,
  useOpportunitySet,
  useProposeOpportunities,
  useProposePersonas,
  useSetStartDate,
  type CampaignDetail,
} from '../api/campaign-queries.js';
import { ErrorState, LoadingState } from '../components/states.js';

/**
 * The campaign chain, as one screen.
 *
 * The stage a user is on is derived from what actually exists on the server —
 * an approved brief, a selected concept, an approved plan — rather than from a
 * step counter the browser keeps. That means a reload, a second tab or someone
 * else's approval all land the user in the right place, and a control cannot be
 * skipped by navigating.
 */
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

function CampaignChain(props: { label: LabelSummary; detail: CampaignDetail }): ReactNode {
  const { label, detail } = props;
  const labelId = label.id;
  const campaignId = detail.campaign.id;
  const [showSocial, setShowSocial] = useState(false);
  const [searchParams]=useSearchParams();
  const requestedStep=searchParams.get('fase');
  const [step,setStep]=useState(requestedStep&&['audience','opportunity','brief','package','social'].includes(requestedStep)?requestedStep:detail.briefApproved?'package':'audience');

  /*
   * Which personas this campaign is being built for.
   *
   * Held here rather than inside step 1 because steps 2 and 3 both need it.
   * That is what lets the numbers describe the order: opportunities can be
   * proposed straight after the choice, and the briefing — which is what binds
   * the choice to the campaign — sits in step 3 where its number says it is.
   *
   * Before this, the brief-draft button lived inside step 1 and drafting was
   * what unlocked step 2, so the flow ran 1 → 3 → 2 → 3 while the headings said
   * 1 → 2 → 3. A browser smoke run stalled on exactly that.
   *
   * Seeded from the approved brief so reopening a campaign shows what it was
   * built for rather than an empty choice.
   */
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>(
    detail.brief?.personaVersionIds ?? [],
  );

  return (
    <>
      <header>
        <h1 className="c360-page-title">{detail.campaign.name}</h1>
        <p className="c360-page-lead">
          {`${detail.campaign.objective === null ? 'Geen doel vastgelegd' : `Doel: ${OBJECTIVE_LABEL_NL[detail.campaign.objective]}`} · ${ENTRY_MODE_NL[detail.campaign.entryMode]} · fase: ${STAGE_NL[detail.campaign.stage] ?? detail.campaign.stage}`}
        </p>
        {detail.campaign.objective === null && (
          <ObjectiveSetter labelId={labelId} campaignId={campaignId} />
        )}
        <div className="c360-row" style={{ marginTop: 'var(--c360-space-3)' }}>
          {detail.aiIsMock && (
            <Badge tone="amber">
              {`AI-aanbieder: ${detail.aiProvider} — voorbeeldteksten, geen echte generatie`}
            </Badge>
          )}
          {detail.briefApproved && <Badge tone="green">Briefing goedgekeurd</Badge>}
        </div>
      </header>

      {(detail.campaign.suppliedBrief ?? detail.campaign.userIdea) && (
        <details style={{ marginBottom: 'var(--c360-space-4)' }}>
          <summary>{detail.campaign.suppliedBrief ? 'Jouw oorspronkelijke briefing — ongewijzigd' : 'Jouw oorspronkelijke idee'}</summary>
          <p style={{ whiteSpace: 'pre-wrap' }}>{detail.campaign.suppliedBrief ?? detail.campaign.userIdea}</p>
        </details>
      )}
      <div className="flow-evidence" aria-label="Informatie beschikbaar">
        <span>{detail.campaign.radarRunId?'✓ Radar gekoppeld':'Geen radarscan gekoppeld'}</span>
        <span>{detail.campaign.suppliedBrief?'✓ Oorspronkelijke briefing bewaard':'Oorspronkelijke briefing ontbreekt'}</span>
        <span>{selectedPersonaIds.length?`✓ ${String(selectedPersonaIds.length)} persona’s geselecteerd`:'Selecteer persona’s'}</span>
        <span>{detail.brief?'✓ Briefing ingevuld':'Briefing nog maken'}</span>
        <span>{detail.briefApproved?'✓ Briefing goedgekeurd':'Briefing nog niet goedgekeurd'}</span>
      </div>
      <p className="c360-card__hint">Een vinkje betekent dat informatie aanwezig is. Goedkeuring wordt apart getoond. Bij een campagne uit radar staat de overgenomen bron in de oorspronkelijke briefing; pakketbestanden bewaren de gebruikte scan, briefing- en merkversie.</p>
      <FlowNavigation steps label="Campagnefasen" value={step} onChange={setStep} items={[{id:'audience',label:'Doelgroep',done:selectedPersonaIds.length>0},{id:'opportunity',label:'Richting'},{id:'brief',label:'Briefing',done:detail.briefApproved},{id:'package',label:'Contentpakket'},{id:'social',label:'Social & beelden'}]} />
      <div className={step==='social' ? "c360-grid-main" : "c360-stack"}>
        <div className="c360-stack">
          <div className="flow-panel" hidden={step!=='audience'}>
          <PersonaStep
            key={campaignId}
            label={label}
            detail={detail}
            selected={selectedPersonaIds}
            onSelectedChange={setSelectedPersonaIds}
          />
          </div><div className="flow-panel" hidden={step!=='opportunity'}>
          <OpportunityStep label={label} detail={detail} selected={selectedPersonaIds} onContinue={()=>setStep('brief')} />
          </div><div className="flow-panel" hidden={step!=='brief'}>
          <BriefStep
            labelId={labelId}
            campaignId={campaignId}
            detail={detail}
            selected={selectedPersonaIds}
          />
          </div><div className="flow-panel" hidden={step!=='package'}>
          <CampaignPackagePanel key={campaignId} labelId={labelId} campaignId={campaignId} ready={detail.brief?.reviewState === 'approved' && detail.briefApproved} canReview={label.role === 'label_manager'||label.role === 'label_approver'} canEdit={label.role !== 'label_viewer'} onSocial={() => { setShowSocial(true); setStep('social'); }} />
          </div><div className="flow-panel" hidden={step!=='social'}>
          {(step==='social' || showSocial || detail.concepts.length > 0 || detail.assets.length > 0) && <>
          <ConceptStep labelId={labelId} campaignId={campaignId} detail={detail} />
          <PlanStep labelId={labelId} campaignId={campaignId} detail={detail} />
          <ContentStep labelId={labelId} campaignId={campaignId} detail={detail} />
          </>}
          </div>
        </div>

        {step==='social' && <div className="c360-stack">
          <GatePanel detail={detail} />
          <ExportPanel labelId={labelId} campaignId={campaignId} detail={detail} />
        </div>}
      </div>
      <div className="c360-row" style={{marginTop:24}}>{step!=='audience'&&<Button onClick={()=>{const steps=['audience','opportunity','brief','package','social'];setStep(steps[steps.indexOf(step)-1]!);}}>Vorige fase</Button>}{step!=='social'&&<Button onClick={()=>{const steps=['audience','opportunity','brief','package','social'];setStep(steps[steps.indexOf(step)+1]!);}}>Volgende fase</Button>}</div>
    </>
  );
}

// ------------------------------------------------------------------- steps ---

function StepCard(props: {
  step: number;
  title: string;
  done: boolean;
  blocked?: string | undefined;
  children: ReactNode;
}): ReactNode {
  return (
    <Card ariaLabel={`Stap ${String(props.step)}: ${props.title}`}>
      <div className="c360-row" style={{ justifyContent: 'space-between' }}>
        <h2 className="c360-card__title" style={{ margin: 0 }}>
          {`${String(props.step)}. ${props.title}`}
        </h2>
        {props.done ? (
          <Badge tone="green">Afgerond</Badge>
        ) : props.blocked !== undefined ? (
          <Badge tone="neutral">Nog niet mogelijk</Badge>
        ) : (
          <Badge tone="purple">Nu aan zet</Badge>
        )}
      </div>
      <div style={{ marginTop: 'var(--c360-space-4)' }}>
        {props.blocked !== undefined ? (
          <p className="c360-card__hint">{props.blocked}</p>
        ) : (
          props.children
        )}
      </div>
    </Card>
  );
}

function PersonaStep(props: {
  label: LabelSummary;
  detail: CampaignDetail;
  selected: readonly string[];
  onSelectedChange: (next: string[]) => void;
}): ReactNode {
  const { label, detail, selected, onSelectedChange } = props;
  const courseVersionId = detail.campaign.courseVersionId;
  const personas = usePersonas(label.id, courseVersionId, detail.campaign.id);
  const propose = useProposePersonas(label.id);

  const tracked = useJobProgress(label.id, detail.campaign.id, propose.data?.id);
  const shortfall = jobResultString(tracked.data ?? propose.data, 'shortfallReasonNl');

  const items = [...new Map([...detail.personas, ...(personas.data?.items ?? [])].map(persona => [persona.id, persona])).values()];
  const done = detail.brief !== null;

  const toggle = (id: string): void => {
    onSelectedChange(
      selected.includes(id)
        ? selected.filter((value) => value !== id)
        : [...selected, id].slice(0, 3),
    );
  };

  return (
    <StepCard step={1} title="Doelgroepen voor deze campagne" done={done}>
      <p className="c360-card__hint">Voorstellen combineren je campagnebriefing of idee met de opleiding, merkregels en onderzoek. Doelgroepen van andere campagnes worden hier niet overgenomen.</p>
      <div className="c360-row">
        <Button
          variant="primary"
          disabled={propose.isPending}
          onClick={() => {
            propose.mutate({ courseVersionId, campaignId: detail.campaign.id });
          }}
        >
          {propose.isPending ? 'Bezig…' : 'Doelgroepen voorstellen'}
        </Button>
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
          propose.mutate({ courseVersionId, campaignId: detail.campaign.id });
        }}
      />

      {/* A short set is always explained. The reason comes from the finished
          job, so it survives a page reload. */}
      {shortfall !== null && (
        <Notice tone="warning" live>
          {shortfall}
        </Notice>
      )}

      {items.length > 0 && (
        <ul className="c360-list" style={{ marginTop: 'var(--c360-space-4)' }}>
          {items.map((persona) => (
            <li className="c360-list__item" key={persona.id}>
              <div style={{ minWidth: 0 }}>
                <label className="c360-row" style={{ gap: 'var(--c360-space-2)' }}>
                  <input
                    type="checkbox"
                    checked={selected.includes(persona.id)}
                    onChange={() => {
                      toggle(persona.id);
                    }}
                    aria-label={`Kies doelgroep ${persona.name}`}
                  />
                  <span className="c360-list__title">{`${persona.name} · v${String(persona.version)}`}</span>
                </label>
                <p className="c360-list__subtitle">{persona.summary}</p>
                <PersonaEvidence persona={persona} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {selected.length > 0 && (
        <p className="c360-card__hint" style={{ marginTop: 'var(--c360-space-4)' }}>
          {`${String(selected.length)} doelgroep(en) gekozen. Ga verder met stap 2 om kansen te laten voorstellen.`}
        </p>
      )}
    </StepCard>
  );
}

/** Grounding and assumptions side by side — the distinction that matters most. */
function PersonaEvidence(props: { persona: PersonaVersion }): ReactNode {
  const { persona } = props;
  return (
    <div className="c360-row" style={{ marginTop: 'var(--c360-space-2)' }}>
      <Badge tone={persona.grounding.length > 0 ? 'green' : 'neutral'}>
        {`${String(persona.grounding.length)} onderbouwing`}
      </Badge>
      <Badge tone="amber">{`${String(persona.assumptions.length)} aanname`}</Badge>
      <span className="c360-stat__caption">{`${String(persona.barriers.length)} barrières`}</span>
    </div>
  );
}

function BriefDraftButton(props: {
  supplied: boolean;
  labelId: string;
  campaignId: string;
  personaVersionIds: string[];
}): ReactNode {
  /*
   * The job must be *followed*, not just started.
   *
   * `useCampaignAction` invalidates the campaign view when the mutation
   * resolves — but the mutation resolves with a queued job, before any work has
   * happened, so that refresh shows the same screen back. Without a watcher
   * the brief is written on the worker and the interface never learns: step 3
   * keeps saying "Er is nog geen briefing" and step 2 keeps asking for
   * personas, so the whole chain looks stuck at step 1 while the API is fine.
   *
   * This was the one step action missing a watcher; every other one has had
   * this since generation moved to the worker (ADR-0016).
   */
  const draft = useCampaignAction<JobSummary, void>(
    props.labelId,
    props.campaignId,
    () => ({
      path: `/labels/${props.labelId}/campaigns/${props.campaignId}/brief/draft`,
      body: { personaVersionIds: props.personaVersionIds },
    }),
  );

  return (
    <div className="c360-stack" style={{ marginTop: 'var(--c360-space-4)' }}>
      {/*
        * Says what the button does before it is pressed.
        *
        * The wording used to point at "stap 3" because the button itself sat in
        * step 1. It lives in step 3 now, so pointing elsewhere would be the
        * mistake: it describes what happens right here.
        */}
      <p className="c360-card__hint">
        {props.supplied
          ? 'Je oorspronkelijke briefing blijft bewaard. We delen deze in vaste velden in en tonen hieronder wat ontbreekt of met elkaar botst, zodat je het kunt controleren.'
          : 'Met je campagne-uitgangspunt en de gekozen doelgroepen werken we hieronder een briefing uit. Die keur je daarna zelf goed.'}
      </p>
      <div className="c360-row">
        <Button
          variant="primary"
          disabled={draft.isPending}
          onClick={() => {
            draft.mutate();
          }}
        >
          {draft.isPending ? 'Briefing wordt verwerkt…' : props.supplied ? 'Mijn briefing structureren en controleren' : 'Briefing uitwerken'}
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
  onContinue:()=>void;
  label: LabelSummary;
  detail: CampaignDetail;
  selected: readonly string[];
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
  // The job reports which proposal set it produced; the set itself is a normal
  // query, so it survives a reload rather than living in mutation state.
  const setId = jobResultString(tracked.data ?? propose.data, 'proposalSetId');
  const opportunities = useOpportunitySet(label.id, setId ?? undefined);

  /*
   * The personas chosen in step 1, not the ones already bound to the campaign.
   *
   * Binding happens when the briefing is drafted, which is step 3 — so gating
   * on the bound set made step 2 wait for step 3. The API never required it:
   * `/opportunities/propose` takes persona version ids directly.
   *
   * A campaign reopened after its briefing was approved falls back to the
   * brief's own personas, so the step stays usable without re-choosing.
   */
  const personaIds =
    selected.length > 0 ? [...selected] : detail.brief?.personaVersionIds ?? [];
  const done = detail.campaign.opportunityId !== null;

  return (
    <StepCard
      step={2}
      title="Campagnerichting"
      done={done}
      blocked={
        personaIds.length === 0 ? 'Kies eerst een of meer doelgroepen in stap 1.' : undefined
      }
    >
      <Button
        disabled={propose.isPending}
        onClick={() => {
          propose.mutate({
            courseVersionId: detail.campaign.courseVersionId,
            personaVersionIds: personaIds,
          });
        }}
      >
        {propose.isPending ? 'Bezig…' : 'Kansen voorstellen'}
      </Button>
      {propose.isError && (
        <p className="c360-field__error" role="alert">
          {propose.error.userMessage}
        </p>
      )}

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

      {attach.error&&<Notice tone="warning">{attach.error.userMessage}</Notice>}
      {attach.isSuccess&&<Notice tone="info">De campagnerichting is opgeslagen. Werk nu de briefing uit.</Notice>}
      {done&&<Button onClick={props.onContinue}>Verder naar briefing</Button>}
      {opportunities.data !== undefined && (
        <ul className="c360-list" style={{ marginTop: 'var(--c360-space-4)' }}>
          {opportunities.data.items.map((opportunity) => (
            <OpportunityRow
              key={opportunity.id}
              opportunity={opportunity}
              onSelect={() => {
                attach.mutate({ opportunityId: opportunity.id }, {onSuccess:()=>props.onContinue()});
              }}
              chosen={detail.campaign.opportunityId===opportunity.id}
              busy={attach.isPending}
            />
          ))}
        </ul>
      )}
    </StepCard>
  );
}

function OpportunityRow(props: {
  chosen:boolean;
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
        {/* The ranking reason is shown, not a score — there is no score. */}
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
      <Button onClick={props.onSelect} disabled={props.busy||props.chosen}>
        {props.chosen?'✓ Gekozen':props.busy?'Opslaan…':'Kies deze'}
      </Button>
    </li>
  );
}

function BriefStep(props: {
  labelId: string;
  campaignId: string;
  detail: CampaignDetail;
  selected: readonly string[];
}): ReactNode {
  const { labelId, campaignId, detail, selected } = props;
  const brief = detail.brief;
  const approve = useCampaignAction<unknown, void>(labelId, campaignId, () => ({
    path: `/labels/${labelId}/campaigns/${campaignId}/brief/${String(brief?.id)}/approve`,
    body: {},
  }));

  return (
    <StepCard
      step={3}
      title="Briefing"
      done={detail.briefApproved}
      blocked={
        brief === null && selected.length === 0
          ? 'Kies eerst een of meer doelgroepen in stap 1.'
          : undefined
      }
    >
      {/*
        * Drafting lives here, in the step whose number it belongs to.
        *
        * It used to sit inside step 1, where it produced the artefact of step 3
        * and unlocked step 2 — so the flow ran 1 → 3 → 2 while the headings
        * said 1 → 2 → 3, and a browser smoke run stalled on it.
        */}
      {!detail.briefApproved && selected.length > 0 && (
        <BriefDraftButton
          supplied={detail.campaign.entryMode === 'start_from_briefing'}
          labelId={labelId}
          campaignId={campaignId}
          personaVersionIds={[...selected]}
        />
      )}

      {brief !== null && (
        <>
          {detail.campaign.suppliedBrief && (
            <details><summary>Oorspronkelijke briefing — ongewijzigd</summary>
              <p style={{ whiteSpace: 'pre-wrap' }}>{detail.campaign.suppliedBrief}</p>
            </details>
          )}
          {brief.reviewNotes.length > 0 && (
            <Notice tone="warning">
              <strong>Controlepunten en ontbrekende informatie</strong>
              <ul>{brief.reviewNotes.map((note, index) => <li key={index}>{note}</li>)}</ul>
            </Notice>
          )}
          <div className="flow-evidence" aria-label="Briefingvelden ingevuld">{[{label:'Doel',filled:Boolean(brief.goal.trim())},{label:'Kernboodschap',filled:Boolean(brief.coreMessage.trim())},{label:'Creatieve richting',filled:Boolean(brief.contentScope.trim())},{label:'Kanalen',filled:brief.channelSuggestions.length>0},{label:'CTA',filled:Boolean(brief.cta.trim())},{label:'Bestemmingslink',filled:Boolean(brief.ctaUrl)}].map(field=><span key={field.label}><span className={field.filled?'flow-check':undefined}>{field.filled?'✓':'○'}</span> {field.label}</span>)}</div>
          <dl className="c360-definition">
            <div>
              <dt className="c360-definition__term">Doel</dt>
              <dd className="c360-definition__value">{brief.goal}</dd>
            </div>
            <div>
              <dt className="c360-definition__term">Kernboodschap</dt>
              <dd className="c360-definition__value">{brief.coreMessage}</dd>
            </div>
            <div>
              <dt className="c360-definition__term">Inhoud en creatieve richting</dt>
              <dd className="c360-definition__value">{brief.contentScope}</dd>
            </div>
            <div>
              <dt className="c360-definition__term">Kanalen</dt>
              <dd className="c360-definition__value">{brief.channelSuggestions.join(', ')}</dd>
            </div>
            <div>
              <dt className="c360-definition__term">Call to action</dt>
              <dd className="c360-definition__value">{brief.cta}{brief.ctaUrl ? ` — ${brief.ctaUrl}` : ''}</dd>
            </div>
            <div>
              <dt className="c360-definition__term">Toegestane claims</dt>
              <dd className="c360-definition__value" style={{ fontWeight: 400 }}>
                {brief.usableClaims.length === 0 ? (
                  <span className="c360-definition__note">Geen — er is niets gecontroleerd om te claimen.</span>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                    {brief.usableClaims.map((claim, index) => (
                      <li key={index} className="c360-definition__note">
                        {claim.claim} <em>({claim.backedBy})</em>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
            <div>
              <dt className="c360-definition__term">Buiten kader</dt>
              <dd className="c360-definition__value" style={{ fontWeight: 400 }}>
                {/* Automatically includes every unconfirmed course field. */}
                <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                  {brief.offLimits.map((item, index) => (
                    <li key={index} className="c360-definition__note">
                      {item}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
            <div>
              <dt className="c360-definition__term">Meten &amp; stoppen</dt>
              <dd className="c360-definition__value" style={{ fontWeight: 400 }}>
                <p className="c360-definition__note">{brief.measurement}</p>
                <p className="c360-definition__note">{brief.stopConditions}</p>
              </dd>
            </div>
          </dl>

          {!detail.briefApproved && (
            <div className="c360-row" style={{ marginTop: 'var(--c360-space-4)' }}>
              <Button
                variant="primary"
                disabled={approve.isPending}
                onClick={() => {
                  approve.mutate();
                }}
              >
                {approve.isPending ? 'Bezig…' : `Briefing v${String(brief.version)} goedkeuren`}
              </Button>
              <span className="c360-stat__caption">
                Zonder goedkeuring kunnen er geen concepten worden gemaakt.
              </span>
            </div>
          )}
        </>
      )}
    </StepCard>
  );
}

function ConceptStep(props: {
  labelId: string;
  campaignId: string;
  detail: CampaignDetail;
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
      step={4}
      title="Concepten & beeldrichting"
      done={detail.selectedConcept !== null}
      blocked={
        detail.briefApproved
          ? undefined
          : 'Keur eerst de briefing goed. Dit is een bewuste controle en kan niet worden overgeslagen.'
      }
    >
      <p className="c360-card__hint">Kies uit drie verschillende beeldideeën: documentaire fotografie, een conceptueel beeld of redactionele illustratie. De gekozen richting stuurt de productie.</p>
      <VisualReferencesPanel labelId={labelId} campaignId={campaignId} assetIds={detail.campaign.visualReferenceAssetIds ?? []} />
      <Button
        disabled={propose.isPending}
        onClick={() => {
          propose.mutate();
        }}
      >
        {propose.isPending ? 'Bezig…' : 'Drie beeldrichtingen voorstellen'}
      </Button>
      {propose.isError && (
        <p className="c360-field__error" role="alert">
          {propose.error.userMessage}
        </p>
      )}

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
                {concept.artDirection && <div className="c360-list__subtitle">
                  <Badge tone="purple">{{ documentary: 'Documentaire fotografie', conceptual: 'Conceptueel beeld', illustration: 'Redactionele illustratie' }[concept.artDirection.medium]}</Badge>
                  <p><strong>Scène:</strong> {concept.artDirection.scene}</p>
                  <p><strong>Compositie:</strong> {concept.artDirection.composition}</p>
                  <p><strong>Licht & uitvoering:</strong> {concept.artDirection.lighting} · {concept.artDirection.treatment}</p>
                </div>}
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
    </StepCard>
  );
}

/**
 * The calendar: relative until a start date is chosen.
 *
 * Shows offsets as "week 1 · dag 1" while no date exists, and real dates once
 * one does. The distinction is made visible rather than hidden behind empty
 * cells, because a plan with no date is a normal, valid state — most campaigns
 * are approved before anyone commits to a week.
 *
 * The whole schedule is derived server-side from the approved plan, so there is
 * nothing to edit here beyond the one date. Warnings are rendered as they come:
 * every one of them is a thing the user can act on, including "there are dates
 * on the course card and I am ignoring them because nobody confirmed them".
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
      <div className="c360-row" style={{ alignItems: 'end' }}>
        <Field
          id={inputId}
          label="Startdatum van de campagne"
          hint="Zonder startdatum blijft de planning relatief. Je kunt de datum later wijzigen of weghalen."
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
          {setStartDate.isPending ? 'Bezig…' : 'Datum vastleggen'}
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
              {props.calendar.isDated
                ? 'Planning met echte data'
                : 'Relatieve planning, zonder startdatum'}
            </caption>
            <thead>
              <tr>
                <th scope="col">Wanneer</th>
                <th scope="col">Kanaal</th>
                <th scope="col">Nummer</th>
              </tr>
            </thead>
            <tbody>
              {props.calendar.slots.map((slot) => (
                <tr key={`${slot.channel}-${String(slot.sequence)}`}>
                  <td>
                    {slot.date ?? `week ${String(slot.week)} · dag ${String((slot.offsetDays % 7) + 1)}`}
                  </td>
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
        hint="Deze campagne is gemaakt voordat doelen bestonden. Het doel bepaalt welke funnelfasen het kanaalplan dekt; zonder doel gaat het plan uit van de hele funnel."
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
        {set.isPending ? 'Bezig…' : 'Doel vastleggen'}
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
}): ReactNode {
  const { labelId, campaignId, detail } = props;
  const propose = useCampaignAction<JobSummary, void>(labelId, campaignId, () => ({
    path: `/labels/${labelId}/campaigns/${campaignId}/plan/propose`,
  }));

  const plan = detail.plan;
  const approved = plan?.reviewState === 'approved';
  // The stages follow from the objective; without one the plan covers the
  // whole funnel, and the notice below says so rather than hiding it.
  const stages = stagesForObjective(detail.campaign.objective ?? 'full_funnel');

  return (
    <StepCard
      step={5}
      title="Kanaalplan"
      done={approved}
      blocked={
        detail.selectedConcept === null ? 'Kies eerst een concept in stap 4.' : undefined
      }
    >
      <p className="c360-card__hint">
        Per funnelfase stelt het systeem kanalen voor met een reden die je kunt controleren. Je kiest
        zelf wat er gemaakt wordt — ook alles, tegen het advies in.
      </p>
      {detail.campaign.objective === null && (
        <Notice tone="info">
          Deze campagne heeft geen doel vastgelegd; het plan gaat uit van de hele funnel. Leg bovenaan
          een doel vast om het plan te richten.
        </Notice>
      )}
      <Button
        disabled={propose.isPending}
        onClick={() => {
          propose.mutate();
        }}
      >
        {propose.isPending ? 'Bezig…' : 'Kanaalplan voorstellen'}
      </Button>
      {propose.isError && (
        <p className="c360-field__error" role="alert">
          {propose.error.userMessage}
        </p>
      )}

      <JobWatcher
        labelId={labelId}
        campaignId={campaignId}
        job={propose.data}
        onRetry={() => {
          propose.mutate();
        }}
      />

      {plan !== null && (
        // Keyed by plan id, so a new proposal resets the selection to what
        // was proposed rather than carrying an older choice across versions.
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
 * one. The advice travels along unchanged — it is not theirs to edit, and the
 * approval binds to what they saw.
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
  const approve = useCampaignAction<unknown, { edited: PlannableContentPlan | null }>(
    labelId,
    campaignId,
    (input) => ({
      path: `/labels/${labelId}/campaigns/${campaignId}/plan/approve`,
      body: input,
    }),
  );

  // A plan from before stages existed has no cells to edit; it is shown as a
  // list and approved as it is.
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
    const existing = plan.items.find(
      (item) => item.stage === cell.stage && item.channel === cell.channel,
    );
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
                  {' '}— elk kanaal in elke fase, ook waar het advies ontraadt. Het advies blijft ernaast staan.
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
              Schatting van de omvang. Het budget wordt per taak gereserveerd zodra de content wordt gemaakt.
            </span>
          </p>
          {selection.size === 0 && (
            <p className="c360-field__error" role="alert">
              Kies minstens één vakje.
            </p>
          )}
          <AdvicePanel stages={stages} plan={plan} />
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
        <Button
          variant="primary"
          disabled={approve.isPending || (!legacy && selection.size === 0)}
          onClick={() => {
            approve.mutate({
              edited: !legacy && changed ? editedPlan(plan, selection, stages) : null,
            });
          }}
        >
          {approve.isPending
            ? 'Bezig…'
            : changed
              ? 'Kanaalplan met mijn keuze goedkeuren'
              : 'Kanaalplan goedkeuren'}
        </Button>
      )}
      {approve.isError && (
        <p className="c360-field__error" role="alert">
          {approve.error.userMessage}
        </p>
      )}
    </div>
  );
}

function ContentStep(props: {
  labelId: string;
  campaignId: string;
  detail: CampaignDetail;
}): ReactNode {
  const { labelId, campaignId, detail } = props;
  const generate = useCampaignAction<JobSummary, void>(labelId, campaignId, () => ({
    path: `/labels/${labelId}/campaigns/${campaignId}/content/generate`,
  }));

  const planApproved = detail.plan?.reviewState === 'approved';

  return (
    <StepCard
      step={6}
      title="Content &amp; beelden"
      done={detail.assets.length > 0 && detail.assets.every((a) => a.reviewState === 'approved')}
      blocked={planApproved ? undefined : 'Keur eerst het contentpakket goed in stap 5.'}
    >
      <div className="c360-row">
        <Button
          variant="primary"
          disabled={generate.isPending}
          onClick={() => {
            generate.mutate();
          }}
        >
          {generate.isPending ? 'Content wordt gemaakt…' : 'Content maken'}
        </Button>
        {generate.isError && (
          <span className="c360-field__error" role="alert">
            {generate.error.userMessage}
          </span>
        )}
      </div>

      {/* The longest job: one text call plus two rendered images per channel.
          Progress is reported per channel, so this moves. */}
      <JobWatcher
        labelId={labelId}
        campaignId={campaignId}
        job={generate.data}
        onRetry={() => {
          generate.mutate();
        }}
      />

      {/* Grouped by stage, so a LinkedIn post is read against *Ontdekken*'s
          message rather than against a campaign-wide thesis. */}
      <div className="c360-stack" style={{ marginTop: 'var(--c360-space-5)' }}>
        {groupAssetsByStage(detail.assets).map((group) => (
          <div key={group.stage ?? 'none'} className="c360-stack">
            {group.stage !== null && (
              <div className="stage-heading">
                <h3 className="c360-card__title" style={{ margin: 0 }}>
                  {FUNNEL_STAGE_LABEL_NL[group.stage]}
                </h3>
                <span className="c360-stat__caption">
                  {FUNNEL_STAGE_GUIDANCE_NL[group.stage].messageNl}
                </span>
              </div>
            )}
            {group.assets.map((asset) => (
              <AssetCard key={asset.id} labelId={labelId} campaignId={campaignId} asset={asset} />
            ))}
          </div>
        ))}
      </div>
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

function AssetCard(props: {
  labelId: string;
  campaignId: string;
  asset: ContentAssetVersion;
}): ReactNode {
  const { labelId, campaignId, asset } = props;
  const [editing, setEditing] = useState(false);
  const [hook, setHook] = useState(asset.copy.hook);
  const [body, setBody] = useState(asset.copy.body);
  const [ctaUrl, setCtaUrl] = useState(asset.copy.ctaUrl ?? '');
  const [instruction, setInstruction] = useState('');

  const edit = useEditContent(labelId, campaignId);
  const approve = useCampaignAction<unknown, void>(labelId, campaignId, () => ({
    path: `/labels/${labelId}/content/${asset.id}/approve`,
    body: {},
  }));
  const [revisionScope, setRevisionScope] = useState<'copy' | 'images' | 'both'>('copy');
  const revise = useCampaignAction<
    JobSummary,
    { instructionNl: string; acceptOverwritingUserEdit: boolean }
  >(labelId, campaignId, (input) => ({
    path: `/labels/${labelId}/content/${asset.id}/revise`,
    body: { ...input, expectedVersion: asset.version, scope: revisionScope },
  }));

  return (
    <Card ariaLabel={`${CHANNEL_LABEL_NL[asset.channel]} versie ${String(asset.version)}`}>
      <div className="c360-row" style={{ justifyContent: 'space-between' }}>
        <span className="c360-list__title">
          {`${CHANNEL_LABEL_NL[asset.channel]} · v${String(asset.version)}`}
        </span>
        <span className="c360-row">
          {asset.funnelStage !== null && (
            <Badge tone="neutral">{FUNNEL_STAGE_LABEL_NL[asset.funnelStage]}</Badge>
          )}
          {asset.variants.some(variant => variant.spec.backgroundAssetId) && <Badge tone="purple">AI-beeld + huisstijl</Badge>}
          {asset.editedByUserId !== null && <Badge tone="purple">Met de hand aangepast</Badge>}
          <Badge tone={REVIEW_TONE[asset.reviewState]}>{REVIEW_NL[asset.reviewState]}</Badge>
        </span>
      </div>

      {asset.warnings.length > 0 && (
        <div className="c360-stack" style={{ marginTop: 'var(--c360-space-3)' }}>
          {asset.warnings.map((warning, index) => (
            <Notice key={index} tone={warning.blocksPublishReady ? 'warning' : 'info'}>
              {warning.messageNl}
            </Notice>
          ))}
        </div>
      )}

      {asset.variants.some(variant => variant.spec.backgroundAssetId) && <p className="c360-card__hint">
        Beeldcontrole vóór goedkeuring: bekijk de grote versie en controleer gezichten/handen, materiaal en licht, leesbaarheid en uitsnede. Bij een onnatuurlijk beeld: kies “Alleen beeld” en beschrijf de gewenste verbetering.
      </p>}
      {/* Two variants: identical message and CTA, different layout. */}
      <div className="c360-row" style={{ marginTop: 'var(--c360-space-4)', alignItems: 'flex-start' }}>
        {asset.variants.map((variant) => (
          <figure key={variant.variant} style={{ margin: 0, maxWidth: '210px' }}>
            {variant.imageAssetId !== null && (
              <a href={assetImageUrl(labelId, variant.imageAssetId)} target="_blank" rel="noreferrer" aria-label={`Bekijk variant ${variant.variant} op ware grootte`}><img
                src={assetImageUrl(labelId, variant.imageAssetId)}
                alt={asset.copy.imageAltText ?? `Ontwerpvariant ${variant.variant}`}
                style={{
                  width: '100%',
                  borderRadius: 'var(--c360-radius)',
                  border: '1px solid var(--c360-border)',
                  display: 'block',
                }}
              /></a>
            )}
            <figcaption className="c360-stat__caption">
              {`Variant ${variant.variant} · ${variant.spec.layout} · ${String(variant.spec.widthPx)}×${String(variant.spec.heightPx)}`}
            </figcaption>
          </figure>
        ))}
      </div>

      {!editing ? (
        <div style={{ marginTop: 'var(--c360-space-4)' }}>
          <p className="c360-list__title" style={{ fontSize: '14px' }}>
            {asset.copy.hook}
          </p>
          <p className="c360-list__subtitle" style={{ whiteSpace: 'pre-wrap' }}>
            {asset.copy.body}
          </p>
          {/*
            * A page's sections, shown in reading order.
            *
            * Only a landing page has these; for a post the list is empty and
            * nothing renders. They are read-only here on purpose: the inline
            * editor below edits hook, body and CTA, and a section editor is a
            * bigger piece of interface than this card should grow. Until it
            * exists, a section is changed by revising the content — which is
            * honest, because the alternative is an editor that silently drops
            * the sections it cannot show.
            */}
          {/*
            * The e-mail as a recipient would see it.
            *
            * In a sandboxed frame: the document is generated from plain text
            * and cannot contain script, and the response carries a `sandbox`
            * policy — so this is the third independent reason it is safe to
            * show, not the only one. `srcDoc` is deliberately not used; the
            * frame fetches the document so the browser applies the response's
            * own headers rather than inheriting ours.
            */}
          {asset.channel === 'email' && (
            <div style={{ marginTop: 'var(--c360-space-3)' }}>
              <p className="c360-stat__caption">
                Voorbeeldweergave. De werkelijke weergave verschilt per e-mailclient; dit systeem
                verzendt niets.
              </p>
              <iframe
                title={`Voorbeeld van de e-mail, versie ${String(asset.version)}`}
                src={`/api/v1/labels/${labelId}/campaigns/${campaignId}/content/${asset.id}/email.html`}
                sandbox=""
                style={{
                  width: '100%',
                  height: 420,
                  border: '1px solid var(--c360-color-border)',
                  borderRadius: 8,
                  background: '#FFFFFF',
                }}
              />
            </div>
          )}

          {/*
            * Advertising copy, as separate lines.
            *
            * A platform rotates between headlines, so which line is which is
            * the thing the user pastes into a form field — flattening them
            * into a paragraph would lose it. There is deliberately no figure
            * beside them: the contract has nowhere to put a volume or a click
            * price, because this system has neither an advertising account nor
            * a measurement period.
            */}
          {asset.copy.ads !== null && (
            <div className="c360-stack" style={{ marginTop: 'var(--c360-space-3)' }}>
              <div>
                <p className="c360-list__title" style={{ fontSize: '13px' }}>
                  Koppen
                </p>
                <ol style={{ paddingLeft: '1.2em', margin: 0 }}>
                  {asset.copy.ads.headlines.map((headline, index) => (
                    <li key={index} className="c360-list__subtitle">
                      {headline}
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <p className="c360-list__title" style={{ fontSize: '13px' }}>
                  Beschrijvingen
                </p>
                <ol style={{ paddingLeft: '1.2em', margin: 0 }}>
                  {asset.copy.ads.descriptions.map((description, index) => (
                    <li key={index} className="c360-list__subtitle">
                      {description}
                    </li>
                  ))}
                </ol>
              </div>
              {asset.copy.ads.keywords.length > 0 && (
                <div>
                  <p className="c360-list__title" style={{ fontSize: '13px' }}>
                    Zoektermen
                  </p>
                  <p className="c360-list__subtitle">
                    {asset.copy.ads.keywords.join(' · ')}
                  </p>
                  <p className="c360-stat__caption">
                    Suggesties. Er staan geen zoekvolumes, klikprijzen of conversieverwachtingen
                    bij: daarvoor is een advertentieaccount en een meetperiode nodig.
                  </p>
                </div>
              )}
              <p className="c360-stat__caption">
                <strong>Onderbouwing:</strong> {asset.copy.ads.rationaleNl}
              </p>
            </div>
          )}

          {asset.copy.sections.length > 0 && (
            <ol className="c360-stack" style={{ marginTop: 'var(--c360-space-3)', paddingLeft: '1.2em' }}>
              {asset.copy.sections.map((section, index) => (
                <li key={index}>
                  <p className="c360-list__title" style={{ fontSize: '13px' }}>
                    {section.heading}
                  </p>
                  <p className="c360-list__subtitle" style={{ whiteSpace: 'pre-wrap' }}>
                    {section.text}
                  </p>
                </li>
              ))}
            </ol>
          )}
          <p className="c360-list__subtitle">
            <strong>{asset.copy.ctaText}</strong>{' '}
            {asset.copy.ctaUrl ?? (
              <em>(link ontbreekt — verplicht voor een publicatieklaar pakket)</em>
            )}
          </p>
        </div>
      ) : (
        <div className="c360-stack" style={{ marginTop: 'var(--c360-space-4)' }}>
          <Field id={`hook-${asset.id}`} label="Hook">
            {(fieldProps) => (
              <input
                {...fieldProps}
                className="c360-input"
                value={hook}
                onChange={(event) => {
                  setHook(event.target.value);
                }}
              />
            )}
          </Field>
          <Field id={`body-${asset.id}`} label="Tekst">
            {(fieldProps) => (
              <textarea
                {...fieldProps}
                className="c360-textarea"
                rows={7}
                value={body}
                onChange={(event) => {
                  setBody(event.target.value);
                }}
              />
            )}
          </Field>
          <Field
            id={`cta-${asset.id}`}
            label="CTA-link"
            hint="Verplicht voor een publicatieklaar pakket; een concept mag zonder."
          >
            {(fieldProps) => (
              <input
                {...fieldProps}
                className="c360-input"
                type="url"
                value={ctaUrl}
                onChange={(event) => {
                  setCtaUrl(event.target.value);
                }}
              />
            )}
          </Field>
          <div className="c360-row">
            <Button
              variant="primary"
              disabled={edit.isPending}
              onClick={() => {
                edit.mutate(
                  {
                    assetId: asset.id,
                    expectedVersion: asset.version,
                    copy: {
                      hook,
                      body,
                      ctaUrl: ctaUrl.trim().length === 0 ? null : ctaUrl.trim(),
                    },
                  },
                  { onSuccess: () => setEditing(false) },
                );
              }}
            >
              {edit.isPending ? 'Opslaan…' : 'Opslaan als nieuwe versie'}
            </Button>
            <Button
              onClick={() => {
                setEditing(false);
              }}
            >
              Annuleren
            </Button>
            {edit.isError && (
              <span className="c360-field__error" role="alert">
                {edit.error.userMessage}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="c360-row" style={{ marginTop: 'var(--c360-space-4)' }}>
        {!editing && (
          <Button
            onClick={() => {
              setEditing(true);
            }}
          >
            Tekst aanpassen
          </Button>
        )}
        {asset.reviewState !== 'approved' && (
          <Button
            variant="primary"
            disabled={approve.isPending}
            onClick={() => {
              approve.mutate();
            }}
          >
            {approve.isPending ? 'Bezig…' : 'Goedkeuren'}
          </Button>
        )}
      </div>

      <div className="c360-stack" style={{ marginTop: 'var(--c360-space-4)' }}>
        <label>Wat wil je herzien?
          <select className="c360-select" value={revisionScope} onChange={event => setRevisionScope(event.target.value as 'copy' | 'images' | 'both')}>
            <option value="copy">Alleen tekst — beeld behouden</option>
            {asset.variants.length > 0 && <option value="images">Alleen beeld — tekst behouden</option>}
            <option value="both">Tekst en beeld</option>
          </select>
        </label>
        <Field
          id={`revise-${asset.id}`}
          label="AI-herziening"
          hint="Schrijf in je eigen woorden wat er anders moet. Alleen dit item wordt opnieuw gemaakt."
        >
          {(fieldProps) => (
            <input
              {...fieldProps}
              className="c360-input"
              value={instruction}
              placeholder="Bijvoorbeeld: korter, en begin met de vraag."
              onChange={(event) => {
                setInstruction(event.target.value);
              }}
            />
          )}
        </Field>
        <div className="c360-row">
          <Button
            disabled={revise.isPending || instruction.trim().length < 3}
            onClick={() => {
              revise.mutate({
                instructionNl: instruction,
                // A hand-edited version is only overwritten on an explicit
                // second confirmation; the first attempt is refused by design.
                acceptOverwritingUserEdit: false,
              });
            }}
          >
            {revise.isPending ? 'Bezig…' : 'Herzien met AI'}
          </Button>
          {revise.isError && (
            <>
              <span className="c360-field__error" role="alert">
                {revise.error.userMessage}
              </span>
              {revise.error.status === 409 && (
                <Button
                  onClick={() => {
                    revise.mutate({
                      instructionNl: instruction,
                      acceptOverwritingUserEdit: true,
                    });
                  }}
                >
                  Toch overschrijven
                </Button>
              )}
            </>
          )}
        </div>
        <JobWatcher labelId={labelId} campaignId={campaignId} job={revise.data} />
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ panels ---

function GatePanel(props: { detail: CampaignDetail }): ReactNode {
  const { gates } = props.detail;
  const allGates = Object.keys(gates.labels) as (keyof typeof gates.labels)[];

  return (
    <Card title="Controles voor publicatie" ariaLabel="Controles voor publicatie">
      <ul className="c360-list">
        {allGates.map((gate) => (
          <li
            key={gate}
            className="c360-list__item"
            style={{ padding: 'var(--c360-space-2) 0', border: 'none' }}
          >
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
    </Card>
  );
}

function ExportPanel(props: {
  labelId: string;
  campaignId: string;
  detail: CampaignDetail;
}): ReactNode {
  const { labelId, campaignId, detail } = props;
  const draft = useCampaignAction<{ export: ExportRecord; ready: boolean }, void>(
    labelId,
    campaignId,
    () => ({
      path: `/labels/${labelId}/campaigns/${campaignId}/exports`,
      body: { kind: 'draft' },
    }),
  );
  const publishReady = useCampaignAction<{ export: ExportRecord; ready: boolean }, void>(
    labelId,
    campaignId,
    () => ({
      path: `/labels/${labelId}/campaigns/${campaignId}/exports`,
      body: { kind: 'publish_ready' },
    }),
  );

  return (
    <Card title="Export" ariaLabel="Export">
      <p className="c360-card__hint">
        Een conceptpakket kan altijd. Een publicatieklaar pakket alleen als alle controles hierboven
        op &quot;ok&quot; staan.
      </p>
      <div className="c360-row" style={{ marginTop: 'var(--c360-space-4)' }}>
        <Button
          disabled={draft.isPending || detail.assets.length === 0}
          onClick={() => {
            draft.mutate();
          }}
        >
          {draft.isPending ? 'Bezig…' : 'Concept exporteren'}
        </Button>
        <Button
          variant="primary"
          disabled={publishReady.isPending || detail.assets.length === 0}
          onClick={() => {
            publishReady.mutate();
          }}
        >
          {publishReady.isPending ? 'Bezig…' : 'Publicatieklaar'}
        </Button>
      </div>

      {/*
        * Both buttons report their own failure.
        *
        * Only the publicatieklaar error used to be rendered, so a failing draft
        * export looked exactly like a successful one: the button returned to
        * its idle label and nothing appeared. A browser smoke run clicked it,
        * called the step done, and the fault was only found afterwards by
        * noticing the export row had never been written.
        */}
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
                <a
                  className="c360-button c360-button--secondary"
                  href={`/api/v1/labels/${labelId}/exports/${record.id}/file`}
                >
                  Download
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
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

const STAGE_NL: Partial<Record<Campaign['stage'], string>> = {
  persona_selection: 'doelgroepen kiezen',
  opportunity_selection: 'kans kiezen',
  brief_approval: 'briefing goedkeuren',
  concept_selection: 'concept kiezen',
  content_plan_approval: 'contentpakket goedkeuren',
  production: 'content maken',
  editing: 'bewerken',
  final_approval: 'laatste goedkeuring',
  export: 'export',
};

const REVIEW_NL: Record<ContentAssetVersion['reviewState'], string> = {
  draft: 'Concept',
  in_review: 'Ter beoordeling',
  changes_requested: 'Wijziging gevraagd',
  approved: 'Goedgekeurd',
  needs_rereview: 'Opnieuw beoordelen',
  archived: 'Gearchiveerd',
};

const REVIEW_TONE: Record<ContentAssetVersion['reviewState'], 'purple' | 'green' | 'amber' | 'neutral'> = {
  draft: 'purple',
  in_review: 'purple',
  changes_requested: 'amber',
  approved: 'green',
  needs_rereview: 'amber',
  archived: 'neutral',
};
