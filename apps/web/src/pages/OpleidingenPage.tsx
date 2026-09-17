import { useId, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { CourseFactField, CourseVersion, LabelSummary } from '@c360/contracts';
import { COURSE_FACT_LABEL_NL, courseFactField } from '@c360/contracts';
import { Badge, Button, Disclosure, Notice, Skeleton } from '@c360/ui';
import { useApproveCourse, useConfirmFacts, useCourses } from '../api/campaign-queries.js';
import { CourseIntakePanel } from '../components/CourseIntakePanel.js';
import { SourcesResearchPanel } from '../components/SourcesResearchPanel.js';
import { Modal } from '../components/Modal.js';
import { ErrorState } from '../components/states.js';

/**
 * Opleidingen — pattern B.
 *
 * The card list on the left, one card's fields on the right. The screen is
 * built around per-field verification, because that is the mechanic that keeps
 * a wrong price or a wrong entry condition out of published material: each
 * field shows its value, what the extractor was unsure about, and whether a
 * person has confirmed it.
 *
 * An empty field is fine and stays empty. A field with an unconfirmed value is
 * what blocks a publish-ready export, and the difference is on the screen.
 */
export function OpleidingenPage(props: { label: LabelSummary | undefined }): ReactNode {
  const courses = useCourses(props.label?.id);
  const [params, setParams] = useSearchParams();
  const [intakeOpen, setIntakeOpen] = useState(false);
  const intakeId = useId();

  if (props.label === undefined) {
    return (
      <div className="os-page">
        <Notice tone="warning">Kies eerst een label.</Notice>
      </div>
    );
  }
  if (courses.isError) {
    return (
      <div className="os-page">
        <ErrorState
          message={courses.error.userMessage}
          requestId={courses.error.requestId}
          onRetry={() => void courses.refetch()}
        />
      </div>
    );
  }

  const canEdit = props.label.role !== 'label_viewer';
  const items = courses.data?.items ?? [];
  const selectedId = params.get('kaart');
  const selected = items.find((entry) => entry.course.id === selectedId) ?? items[0];

  return (
    <div className="os-split os-split--narrow">
      <section className="os-split__list" aria-label="Opleidingskaarten">
        <div className="os-split__head">
          <div className="os-split__title">
            <h1>Opleidingen</h1>
            <span className="os-split__count">
              {`${String(items.length)} ${items.length === 1 ? 'kaart' : 'kaarten'}`}
            </span>
          </div>
          {canEdit && (
            <Button
              variant="primary"
              icon="plus"
              aria-controls={intakeId}
              onClick={() => {
                setIntakeOpen(true);
              }}
            >
              Opleidingskaart toevoegen
            </Button>
          )}
        </div>

        <div className="os-split__scroll">
          {courses.isPending && (
            <div style={{ padding: 12 }}>
              <Skeleton lines={4} label="Opleidingen worden geladen" />
            </div>
          )}
          {items.map((entry) => {
            const course = entry.course;
            const checked = courseFactField.options.filter(
              (field) => course.facts[field].state === 'user_confirmed',
            ).length;
            return (
              <button
                key={course.id}
                type="button"
                className="os-split__row"
                aria-current={selected?.course.id === course.id}
                onClick={() => {
                  setParams(
                    (previous) => {
                      const next = new URLSearchParams(previous);
                      next.set('kaart', course.id);
                      return next;
                    },
                    { replace: true },
                  );
                }}
              >
                <span className="os-split__marker" />
                <span className="os-split__body">
                  <span className="os-split__line">
                    <span className="os-split__eyebrow">{`v${String(course.version)}`}</span>
                    <span style={{ flex: 1 }} />
                    {course.origin === 'demo' && <span className="os-pill os-pill--warn">Demo</span>}
                    <span
                      className={`os-pill ${course.reviewState === 'approved' ? 'os-pill--ok' : 'os-pill--outline'}`}
                    >
                      {course.reviewState === 'approved' ? 'Goedgekeurd' : 'Concept'}
                    </span>
                  </span>
                  <span className="os-split__name">{course.name}</span>
                  <span className="os-split__meta">
                    {`${String(checked)} van ${String(courseFactField.options.length)} velden gecontroleerd`}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="os-split__foot">
          Een kaart maak je uit een opleidingspagina, een Word-document of een PDF. Een intern adres
          wordt geweigerd voordat er werk in de wachtrij komt.
        </div>
      </section>

      <section className="os-detail">
        {intakeOpen && (
          <Modal
            labelledBy={intakeId}
            onClose={() => {
              setIntakeOpen(false);
            }}
          >
            <h2 className="c360-section-title" id={intakeId} style={{ margin: 0 }}>
              Opleidingskaart toevoegen
            </h2>
            <CourseIntakePanel labelId={props.label.id} />
          </Modal>
        )}

        {selected === undefined ? (
          <>
            <div className="os-page__head">
              <div className="os-page__head-text">
                <p className="os-eyebrow">Kennis &amp; beheer</p>
                <h1>Opleidingen</h1>
                <p className="c360-page-lead">
                  De opleidingskaart is de enige bron van feiten voor content. Per veld staat wie het
                  heeft gecontroleerd; wat niet is gecontroleerd, wordt nooit gebruikt en blokkeert
                  een publicatieklaar pakket.
                </p>
              </div>
            </div>
            {!courses.isPending && (
              <Notice tone="info">
                Nog geen opleidingskaart voor dit label. Lees een opleidingspagina of een eigen
                document in; het systeem stelt een conceptkaart voor die jij per veld controleert.
              </Notice>
            )}
          </>
        ) : (
          <CourseDetail key={selected.course.id} labelId={props.label.id} course={selected.course} canEdit={canEdit} />
        )}
      </section>
    </div>
  );
}

function CourseDetail(props: {
  labelId: string;
  course: CourseVersion;
  canEdit: boolean;
}): ReactNode {
  const { labelId, course } = props;
  const [selected, setSelected] = useState<CourseFactField[]>([]);
  const [showSources, setShowSources] = useState(false);
  const confirm = useConfirmFacts(labelId);
  const approve = useApproveCourse(labelId);

  const fields = courseFactField.options;
  const outstanding = fields.filter((field) => {
    const fact = course.facts[field];
    return fact.value !== null && fact.state !== 'user_confirmed';
  });
  const confirmed = fields.filter((field) => course.facts[field].state === 'user_confirmed').length;

  return (
    <>
      <div className="os-page__head">
        <div className="os-page__head-text">
          <p className="os-eyebrow">{`Kennis & beheer · opleidingskaart v${String(course.version)}`}</p>
          <h1>{course.name}</h1>
          {course.sourceRef !== null && (
            <p className="c360-page-lead">
              <a href={/^https?:\/\//u.test(course.sourceRef) ? course.sourceRef : undefined} target="_blank" rel="noreferrer">
                {course.sourceRef}
              </a>
            </p>
          )}
        </div>
        <div className="os-page__actions">
          <Button
            variant="secondary"
            onClick={() => {
              setShowSources((open) => !open);
            }}
          >
            {showSources ? 'Verberg bronnen & onderzoek' : 'Bronnen & onderzoek'}
          </Button>
          {props.canEdit && course.reviewState !== 'approved' && (
            <Button
              variant="primary"
              disabled={approve.isPending || outstanding.length > 0}
              busy={approve.isPending}
              title={
                outstanding.length > 0
                  ? `Eerst controleren: ${outstanding.map((field) => COURSE_FACT_LABEL_NL[field]).join(', ')}`
                  : undefined
              }
              onClick={() => {
                approve.mutate({ versionId: course.id });
              }}
            >
              Opleidingskaart goedkeuren
            </Button>
          )}
        </div>
      </div>

      <div className="os-progressline">
        <span className="os-progressline__count">
          {`${String(confirmed)} VAN ${String(fields.length)}`}
        </span>
        <span className="os-progressline__text">
          velden gecontroleerd. Wat niet is gecontroleerd, wordt nooit in content gebruikt en
          blokkeert een publicatieklaar pakket.
        </span>
        <span className="os-progressline__bar">
          <span
            className="os-progressline__fill"
            style={{ width: `${String(Math.round((confirmed / fields.length) * 100))}%` }}
          />
        </span>
      </div>

      {confirm.isError && <Notice tone="warning">{confirm.error.userMessage}</Notice>}
      {approve.isError && <Notice tone="warning">{approve.error.userMessage}</Notice>}

      <div className="os-panel">
        {fields.map((field) => {
          const fact = course.facts[field];
          const confirmable = fact.value !== null && fact.state !== 'user_confirmed';
          return (
            <div className="os-factrow" key={field}>
              <span className="os-factrow__field">
                {props.canEdit && confirmable && (
                  <input
                    type="checkbox"
                    checked={selected.includes(field)}
                    aria-label={`Bevestig ${COURSE_FACT_LABEL_NL[field]}`}
                    onChange={() => {
                      setSelected((current) =>
                        current.includes(field)
                          ? current.filter((value) => value !== field)
                          : [...current, field],
                      );
                    }}
                  />
                )}
                <span>{COURSE_FACT_LABEL_NL[field]}</span>
              </span>
              <span className="os-factrow__value">
                {fact.value === null ? (
                  <span style={{ color: 'var(--tx-3)' }}>
                    Niet bekend — wordt niet gebruikt en wordt niet geraden
                  </span>
                ) : (
                  <>
                    <span>{fact.value}</span>
                    {fact.uncertaintyNl !== null && (
                      <span className="os-note os-note--err" style={{ display: 'block', marginTop: 5 }}>
                        {fact.uncertaintyNl}
                      </span>
                    )}
                  </>
                )}
              </span>
              <span className="os-factrow__status">
                {fact.value === null ? (
                  <Badge tone="neutral">Leeg</Badge>
                ) : fact.state === 'user_confirmed' ? (
                  <Badge tone="green">Gecontroleerd</Badge>
                ) : fact.state === 'conflicting' ? (
                  <Badge tone="red">Tegenstrijdig</Badge>
                ) : (
                  <Badge tone="amber">Niet gecontroleerd</Badge>
                )}
              </span>
            </div>
          );
        })}
        <div className="os-panel__foot">
          <p className="os-limit">
            Per veld staat wie het heeft gecontroleerd. Een veld dat leeg blijft, wordt niet geraden:
            het systeem leest geen opleidingsdatum uit de prozatekst van de pagina.
          </p>
        </div>
      </div>

      {props.canEdit && (
        <div className="c360-row">
          <Button
            variant="primary"
            disabled={selected.length === 0 || confirm.isPending}
            busy={confirm.isPending}
            onClick={() => {
              confirm.mutate(
                { versionId: course.id, fields: selected },
                {
                  onSuccess: () => {
                    setSelected([]);
                  },
                },
              );
            }}
          >
            {`Bevestig ${String(selected.length)} veld(en) als gecontroleerd`}
          </Button>
          <Disclosure summary="Hoe werkt de controle per veld?" tone="plain">
            <p>
              Elk veld draagt zijn bron en de twijfel van de lezer die het voorstelde. Vink de velden
              aan die je hebt nagekeken en bevestig ze; pas daarna kan de kaart worden goedgekeurd.
              Een leeg veld is geen probleem, een niet-gecontroleerd veld met een waarde wel: dat
              blijft uit alle content.
            </p>
          </Disclosure>
        </div>
      )}

      {outstanding.length > 0 && (
        <Notice tone="warning">
          {`Nog te controleren: ${outstanding.map((field) => COURSE_FACT_LABEL_NL[field]).join(', ')}. Deze informatie wordt niet in content gebruikt en blokkeert een publicatieklaar pakket.`}
        </Notice>
      )}

      {showSources && <SourcesResearchPanel key={course.id} labelId={labelId} course={course} />}
    </>
  );
}
