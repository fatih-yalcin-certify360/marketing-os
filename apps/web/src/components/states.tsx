import type { ReactNode } from 'react';
import { Button, Card, Notice, Skeleton } from '@c360/ui';

/**
 * Shared loading and failure states.
 *
 * The failure state shows the Dutch message plus the request id — enough for a
 * user to report the problem usefully, without exposing anything internal.
 */

export function LoadingState(props: { label: string }): ReactNode {
  return (
    <Card ariaLabel={props.label}>
      <Skeleton lines={4} label={`${props.label}…`} />
    </Card>
  );
}

export function ErrorState(props: {
  message: string;
  requestId?: string | undefined;
  onRetry?: () => void;
}): ReactNode {
  return (
    <Card ariaLabel="Er is iets misgegaan">
      <Notice tone="warning" live>
        {props.message}
      </Notice>
      <div className="c360-row" style={{ marginTop: 'var(--c360-space-4)' }}>
        {props.onRetry !== undefined && <Button onClick={props.onRetry}>Opnieuw proberen</Button>}
        {props.requestId !== undefined && (
          <span className="c360-stat__caption">{`Referentie: ${props.requestId}`}</span>
        )}
      </div>
    </Card>
  );
}
