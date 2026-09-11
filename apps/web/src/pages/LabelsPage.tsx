import { useState, type ReactNode } from 'react';
import type { CurrentUser, LabelRole, LabelSummary } from '@c360/contracts';
import { Badge, Button, Card, Field, Notice } from '@c360/ui';
import {
  useLabelMembers,
  useLabels,
  useMemberCandidates,
  useRevokeMember,
  useSetMemberRole,
} from '../api/queries.js';
import { ErrorState, LoadingState } from '../components/states.js';

/**
 * Labels & toegang.
 *
 * Shows exactly the labels the signed-in user has a membership for. A label
 * they cannot access is not listed at all — not greyed out — because the API
 * never returns it.
 */
export function LabelsPage(props: { user: CurrentUser | undefined }): ReactNode {
  const labels = useLabels();

  if (labels.isPending) {
    return <LoadingState label="Labels worden geladen" />;
  }
  if (labels.isError) {
    return (
      <ErrorState
        message={labels.error.userMessage}
        requestId={labels.error.requestId}
        onRetry={() => void labels.refetch()}
      />
    );
  }

  return (
    <>
      <header>
        <h1 className="c360-page-title">Labels &amp; toegang</h1>
        <p className="c360-page-lead">
          Je ziet hier alleen de labels waarvoor je een rol hebt. Rechten worden op de server
          bepaald op basis van je lidmaatschap.
        </p>
      </header>

      <Card ariaLabel="Jouw labels">
        <div className="c360-table-scroll">
          <table className="c360-table">
            <caption className="c360-visually-hidden">Labels met jouw rol</caption>
            <thead>
              <tr>
                <th scope="col">Label</th>
                <th scope="col">Jouw rol</th>
                <th scope="col">Herkomst</th>
              </tr>
            </thead>
            <tbody>
              {labels.data.items.map((label) => (
                <tr key={label.id}>
                  <td>
                    <span style={{ fontWeight: 700 }}>{label.name}</span>
                    <br />
                    <span className="c360-stat__caption">{label.slug}</span>
                  </td>
                  <td>{ROLE_LABEL_NL[label.role] ?? label.role}</td>
                  <td>
                    <OriginBadge label={label} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Jouw account" ariaLabel="Jouw account">
        <dl className="c360-definition">
          <div>
            <dt className="c360-definition__term">Naam</dt>
            <dd className="c360-definition__value">{props.user?.displayName ?? '—'}</dd>
          </div>
          <div>
            <dt className="c360-definition__term">Organisatie</dt>
            <dd className="c360-definition__value">{props.user?.organizationName ?? '—'}</dd>
          </div>
          <div>
            <dt className="c360-definition__term">Aanmeldwijze</dt>
            <dd className="c360-definition__value">
              {props.user?.authMode === 'local'
                ? 'Lokale testidentiteit (alleen ontwikkeling)'
                : 'Bedrijfsaanmelding via de beveiligde proxy'}
              <p className="c360-definition__note">
                {props.user?.authMode === 'local'
                  ? 'Deze modus is uitgeschakeld in productie; de applicatie start dan niet op.'
                  : 'Identiteit wordt door de proxy vastgesteld; de applicatie beheert zelf geen wachtwoorden.'}
              </p>
            </dd>
          </div>
        </dl>
      </Card>

      <MembersPanel labels={labels.data.items} user={props.user} />
    </>
  );
}

/**
 * Who works on a label, and — for whoever may change it — how.
 *
 * The authority split is visible in the screen rather than only in the API:
 * everyone who can read a label sees its team, and the controls appear only
 * when the organisation-scoped candidate list came back. A label manager
 * therefore sees exactly who has access and no way to widen it, which is the
 * access matrix rendered rather than restated.
 */
function MembersPanel(props: {
  labels: readonly LabelSummary[];
  user: CurrentUser | undefined;
}): ReactNode {
  const [selected, setSelected] = useState<string | undefined>(props.labels[0]?.id);
  const labelId = selected ?? props.labels[0]?.id;

  const members = useLabelMembers(labelId);
  const candidates = useMemberCandidates(labelId);
  const setRole = useSetMemberRole(labelId ?? '');
  const revoke = useRevokeMember(labelId ?? '');

  const [pendingUser, setPendingUser] = useState('');
  const [pendingRole, setPendingRole] = useState<LabelRole>('label_editor');

  if (labelId === undefined) {
    return null;
  }

  /*
   * A 403 on the candidate list is not an error: it is what a caller without
   * `member:manage` gets, and the screen reads it as "you may look, not
   * change". Any other failure is shown as a failure.
   */
  const mayManage = candidates.isSuccess;
  const candidateRefused = candidates.isError && candidates.error.status === 403;

  return (
    <Card title="Leden per label" ariaLabel="Leden per label">
      <Field id="members-label" label="Label" hint="Je ziet alleen labels waarvoor je een rol hebt.">
        {(fieldProps) => (
        <select
          {...fieldProps}
          className="c360-select"
          value={labelId}
          onChange={(event) => {
            setSelected(event.target.value);
          }}
        >
          {props.labels.map((label) => (
            <option key={label.id} value={label.id}>
              {label.name}
            </option>
          ))}
        </select>
        )}
      </Field>

      {members.isPending && <LoadingState label="Leden worden geladen" />}
      {members.isError && (
        <ErrorState
          message={members.error.userMessage}
          requestId={members.error.requestId}
          onRetry={() => void members.refetch()}
        />
      )}

      {members.isSuccess && (
        <div className="c360-table-scroll" style={{ marginTop: 'var(--c360-space-4)' }}>
          <table className="c360-table">
            <caption className="c360-visually-hidden">Leden van dit label</caption>
            <thead>
              <tr>
                <th scope="col">Naam</th>
                <th scope="col">Rol op dit label</th>
                {mayManage && <th scope="col">Actie</th>}
              </tr>
            </thead>
            <tbody>
              {members.data.items.map((member) => (
                <tr key={member.userId}>
                  <td>
                    <span style={{ fontWeight: 700 }}>{member.displayName}</span>
                    <br />
                    <span className="c360-stat__caption">{member.email}</span>
                  </td>
                  <td>
                    {mayManage ? (
                      <select
                        className="c360-select"
                        value={member.role}
                        aria-label={`Rol van ${member.displayName}`}
                        disabled={setRole.isPending}
                        onChange={(event) => {
                          setRole.mutate({
                            userId: member.userId,
                            role: event.target.value as LabelRole,
                          });
                        }}
                      >
                        {ROLE_OPTIONS.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABEL_NL[role] ?? role}
                          </option>
                        ))}
                      </select>
                    ) : (
                      (ROLE_LABEL_NL[member.role] ?? member.role)
                    )}
                    {member.userId === props.user?.userId && (
                      <span className="c360-stat__caption"> · dat ben jij</span>
                    )}
                  </td>
                  {mayManage && (
                    <td>
                      <Button
                        variant="secondary"
                        disabled={revoke.isPending}
                        onClick={() => {
                          revoke.mutate({ userId: member.userId });
                        }}
                      >
                        Toegang intrekken
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(setRole.isError || revoke.isError) && (
        <Notice tone="warning" live>
          {setRole.error?.userMessage ?? revoke.error?.userMessage}
        </Notice>
      )}

      {candidateRefused && (
        <Notice tone="info">
          Je kunt zien wie toegang heeft, maar toegang geven of intrekken hoort bij een
          organisatiebeheerder. Zo kan een labelbeheerder zichzelf geen extra label geven.
        </Notice>
      )}

      {mayManage && candidates.data.items.length > 0 && (
        <div className="c360-stack" style={{ marginTop: 'var(--c360-space-5)' }}>
          <h3 className="c360-card__title">Iemand toevoegen</h3>
          <Field id="members-person" label="Persoon">
            {(fieldProps) => (
              <select
                {...fieldProps}
                className="c360-select"
                value={pendingUser}
                onChange={(event) => {
                  setPendingUser(event.target.value);
                }}
              >
                <option value="">Kies iemand…</option>
                {candidates.data.items.map((candidate) => (
                  <option key={candidate.userId} value={candidate.userId}>
                    {`${candidate.displayName} · ${candidate.email}`}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id="members-role" label="Rol">
            {(fieldProps) => (
              <select
                {...fieldProps}
                className="c360-select"
                value={pendingRole}
                onChange={(event) => {
                  setPendingRole(event.target.value as LabelRole);
                }}
              >
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABEL_NL[role] ?? role}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <div className="c360-row">
            <Button
              variant="primary"
              disabled={pendingUser === '' || setRole.isPending}
              onClick={() => {
                setRole.mutate(
                  { userId: pendingUser, role: pendingRole },
                  { onSuccess: () => { setPendingUser(''); } },
                );
              }}
            >
              {setRole.isPending ? 'Bezig…' : 'Toegang geven'}
            </Button>
          </div>
        </div>
      )}

      {mayManage && candidates.data.items.length === 0 && (
        <Notice tone="neutral">
          Iedereen in de organisatie heeft al een rol op dit label.
        </Notice>
      )}

      <Notice tone="info">
        Een wijziging geldt vanaf het volgende verzoek van die persoon; er is geen sessie die
        eerst hoeft te verlopen. Elke wijziging wordt vastgelegd in het auditspoor.
      </Notice>
    </Card>
  );
}

/** Roles in the order a person thinks about them: most access first. */
const ROLE_OPTIONS: readonly LabelRole[] = [
  'label_manager',
  'label_approver',
  'label_editor',
  'label_viewer',
];

function OriginBadge(props: { label: LabelSummary }): ReactNode {
  if (props.label.origin === 'demo') {
    return <Badge tone="amber">Demo</Badge>;
  }
  return <Badge tone="neutral">Ingevoerd</Badge>;
}

const ROLE_LABEL_NL: Record<string, string> = {
  label_manager: 'Labelbeheerder',
  label_editor: 'Redacteur',
  label_approver: 'Beoordelaar',
  label_viewer: 'Meelezer',
};
