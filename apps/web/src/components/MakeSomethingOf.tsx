import { useId, useState, type ReactNode } from 'react';
import type { ContentOriginKind, FunnelStage } from '@c360/contracts';
import { Button } from '@c360/ui';
import { Modal } from './Modal.js';
import { StandaloneContentForm } from './StandaloneContentForm.js';

/**
 * The fork between a campaign and one loose piece, wherever a finding sits.
 *
 * Every radar view ends in something a person might act on — an insight, a
 * card, a search question, an audience finding, an advertisement — and each of
 * them used to offer exactly one way out: "maak campagne". That is a heavy
 * answer to a small opportunity: eight steps, a briefing, a concept and a
 * channel plan for what is sometimes one article (2026-09-15).
 *
 * One component rather than the same state machine in five panels, and for one
 * more reason: the first version rendered the form inside the card the request
 * came from, and on the Kansen tab that card is a narrow column far above the
 * fold, so clicking looked like nothing happened. Both steps now open over the
 * page, where the choice was made.
 */
export function MakeSomethingOf(props: {
  labelId: string;
  /** The course the finding is about, so the loose piece lands on the right card. */
  courseVersionId: string;
  /** What the button says in this context. */
  buttonLabel: string;
  dialogTitle: string;
  /** The finding itself, in one line, so the chooser says what it is about. */
  subjectNl: string;
  /** The whole instruction for a loose piece; there is no briefing to lean on. */
  angleNl: string;
  stage?: FunnelStage | null | undefined;
  originKind: ContentOriginKind;
  originRefId?: string | null | undefined;
  /** Starts the eight-step flow. The caller owns the objective and the route. */
  onCampaign: () => void;
  /** Called after a loose piece was written, so the screen can move on. */
  onLooseMade: () => void;
  busy?: boolean | undefined;
  disabled?: boolean | undefined;
}): ReactNode {
  const [step, setStep] = useState<'closed' | 'choosing' | 'loose'>('closed');
  const headingId = useId();

  return (
    <>
      <Button
        disabled={props.disabled === true || props.busy === true}
        busy={props.busy === true}
        onClick={() => {
          setStep('choosing');
        }}
      >
        {props.buttonLabel}
      </Button>

      {step === 'choosing' && (
        <Modal
          labelledBy={headingId}
          busy={props.busy}
          onClose={() => {
            setStep('closed');
          }}
        >
          <h2 className="c360-section-title" id={headingId} style={{ margin: 0 }}>
            {props.dialogTitle}
          </h2>
          <p className="c360-card__hint">{props.subjectNl}</p>

          <div className="choice-options">
            <button
              type="button"
              className="choice-option"
              disabled={props.busy === true}
              onClick={() => {
                setStep('closed');
                props.onCampaign();
              }}
            >
              <span className="choice-option__title">Volledige campagne</span>
              <span className="choice-option__body">
                De acht stappen: doelgroep, briefing, concept, kanaalplan, content, export en
                resultaten. Voor iets dat over meerdere kanalen en meerdere weken loopt.
              </span>
            </button>

            <button
              type="button"
              className="choice-option"
              disabled={props.busy === true}
              onClick={() => {
                setStep('loose');
              }}
            >
              <span className="choice-option__title">Losse uiting</span>
              <span className="choice-option__body">
                Eén stuk, zonder campagne: één opleiding, één kanaal, één tekst. Rust op de
                opleidingskaart en het merkprofiel, en is later alsnog aan een campagne te koppelen.
              </span>
            </button>
          </div>

          <div className="c360-row" style={{ marginTop: 'var(--c360-space-4)' }}>
            <Button
              variant="ghost"
              disabled={props.busy === true}
              onClick={() => {
                setStep('closed');
              }}
            >
              Annuleren
            </Button>
          </div>
        </Modal>
      )}

      {step === 'loose' && (
        <Modal
          labelledBy={headingId}
          onClose={() => {
            setStep('closed');
          }}
        >
          <StandaloneContentForm
            labelId={props.labelId}
            headingId={headingId}
            seed={{
              courseVersionId: props.courseVersionId,
              angleNl: props.angleNl,
              stage: props.stage,
              originKind: props.originKind,
              originRefId: props.originRefId,
            }}
            onQueued={() => {
              setStep('closed');
              props.onLooseMade();
            }}
            onCancel={() => {
              setStep('closed');
            }}
          />
        </Modal>
      )}
    </>
  );
}
