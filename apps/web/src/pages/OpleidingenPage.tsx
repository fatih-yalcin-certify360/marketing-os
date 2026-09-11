import { CourseIntakePanel } from '../components/CourseIntakePanel.js';
import { SourcesResearchPanel } from '../components/SourcesResearchPanel.js';
import { useState, type ReactNode } from 'react';
import type { CourseFactField, CourseVersion, LabelSummary } from '@c360/contracts';
import { COURSE_FACT_LABEL_NL, courseFactField } from '@c360/contracts';
import { Badge, Button, Card, Notice } from '@c360/ui';
import { useApproveCourse, useConfirmFacts, useCourses } from '../api/campaign-queries.js';
import { ErrorState, LoadingState } from '../components/states.js';

/**
 * Course cards.
 *
 * The screen is built around per-field verification, because that is the
 * mechanic that keeps a wrong price or a wrong entry condition out of published
 * material. Each factual field shows its value, where it came from, what the
 * extractor was unsure about, and whether a person has confirmed it.
 *
 * A field with no value is fine. A field with an unconfirmed value is what
 * blocks a publish-ready export — the distinction is made explicit here.
 */
export function OpleidingenPage(props: { label: LabelSummary | undefined }): ReactNode {
  const courses = useCourses(props.label?.id);

  if (props.label === undefined) {
    return <Notice tone="warning">Kies eerst een label.</Notice>;
  }
  if (courses.isPending) {
    return <LoadingState label="Opleidingen worden geladen" />;
  }
  if (courses.isError) {
    return (
      <ErrorState
        message={courses.error.userMessage}
        requestId={courses.error.requestId}
        onRetry={() => void courses.refetch()}
      />
    );
  }

  return (
    <>
      <header>
        <h1 className="c360-page-title">Opleidingen</h1>
        <p className="c360-page-lead">
          Per veld wordt bijgehouden wie de informatie heeft gecontroleerd. Niet-gecontroleerde
          informatie wordt nooit in content gebruikt en blokkeert een publicatieklaar pakket.
        </p>
      </header>

      {courses.data.items.length === 0 && (
        <Notice tone="warning">
          Er is nog geen opleidingskaart voor dit label. Lees hieronder een opleidingspagina of een
          eigen document in om een conceptkaart te laten voorstellen.
        </Notice>
      )}

      <CourseIntakePanel labelId={props.label.id} />

      {courses.data.items.map((item) => (
        <CourseCard key={item.course.id} labelId={props.label!.id} course={item.course} />
      ))}
    </>
  );
}

function CourseCard(props: { labelId: string; course: CourseVersion }): ReactNode {
  const { labelId, course } = props;
  const [selected, setSelected] = useState<CourseFactField[]>([]);
  const confirm = useConfirmFacts(labelId);
  const approve = useApproveCourse(labelId);

  const outstanding = courseFactField.options.filter((field) => {
    const fact = course.facts[field];
    return fact.value !== null && fact.state !== 'user_confirmed';
  });

  return (
    <Card ariaLabel={course.name}>
      <div className="c360-row" style={{ justifyContent: 'space-between' }}>
        <span>
          <span className="c360-list__title">{`${course.name} · v${String(course.version)}`}</span>
          <br />
          <span className="c360-stat__caption">{course.sourceRef ?? 'Handmatig ingevoerd'}</span>
        </span>
        <span className="c360-row">
          {course.origin === 'demo' && <Badge tone="amber">Demo</Badge>}
          <Badge tone={course.reviewState === 'approved' ? 'green' : 'purple'}>
            {course.reviewState === 'approved' ? 'Goedgekeurd' : 'Concept'}
          </Badge>
        </span>
      </div>

      <div className="c360-table-scroll" style={{ marginTop: 'var(--c360-space-4)' }}>
        <table className="c360-table">
          <caption className="c360-visually-hidden">Feitelijke velden en hun controlestatus</caption>
          <thead>
            <tr>
              <th scope="col">Bevestig</th>
              <th scope="col">Veld</th>
              <th scope="col">Waarde</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {courseFactField.options.map((field) => {
              const fact = course.facts[field];
              const confirmable = fact.value !== null && fact.state !== 'user_confirmed';
              return (
                <tr key={field}>
                  <td>
                    {confirmable ? (
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
                    ) : (
                      <span className="c360-stat__caption">—</span>
                    )}
                  </td>
                  <td>
                    <strong>{COURSE_FACT_LABEL_NL[field]}</strong>
                  </td>
                  <td style={{ maxWidth: '40ch' }}>
                    {fact.value === null ? (
                      <span className="c360-stat__caption">Niet bekend — wordt niet gebruikt</span>
                    ) : (
                      <>
                        {fact.value}
                        {fact.uncertaintyNl !== null && (
                          <p className="c360-field__error" style={{ marginTop: 4 }}>
                            {fact.uncertaintyNl}
                          </p>
                        )}
                      </>
                    )}
                  </td>
                  <td>
                    {fact.value === null ? (
                      <Badge tone="neutral">Leeg</Badge>
                    ) : fact.state === 'user_confirmed' ? (
                      <Badge tone="green">Gecontroleerd</Badge>
                    ) : fact.state === 'conflicting' ? (
                      <Badge tone="red">Tegenstrijdig</Badge>
                    ) : (
                      <Badge tone="amber">Niet gecontroleerd</Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="c360-row" style={{ marginTop: 'var(--c360-space-4)' }}>
        <Button
          disabled={selected.length === 0 || confirm.isPending}
          onClick={() => {
            confirm.mutate(
              { versionId: course.id, fields: selected },
              { onSuccess: () => setSelected([]) },
            );
          }}
        >
          {confirm.isPending
            ? 'Bezig…'
            : `Bevestig ${String(selected.length)} veld(en) als gecontroleerd`}
        </Button>

        {course.reviewState !== 'approved' && (
          <Button
            variant="primary"
            disabled={approve.isPending || outstanding.length > 0}
            title={
              outstanding.length > 0
                ? `Eerst controleren: ${outstanding.map((f) => COURSE_FACT_LABEL_NL[f]).join(', ')}`
                : undefined
            }
            onClick={() => {
              approve.mutate({ versionId: course.id });
            }}
          >
            {approve.isPending ? 'Bezig…' : 'Opleidingskaart goedkeuren'}
          </Button>
        )}

        {confirm.isError && (
          <span className="c360-field__error" role="alert">
            {confirm.error.userMessage}
          </span>
        )}
        {approve.isError && (
          <span className="c360-field__error" role="alert">
            {approve.error.userMessage}
          </span>
        )}
      </div>

      {outstanding.length > 0 && (
        <Notice tone="warning">
          {`Nog te controleren: ${outstanding.map((f) => COURSE_FACT_LABEL_NL[f]).join(', ')}. Deze informatie wordt niet in content gebruikt en blokkeert een publicatieklaar pakket.`}
        </Notice>
      )}
      <SourcesResearchPanel key={course.id} labelId={labelId} course={course} />
    </Card>
  );
}
