import { useEffect, useRef, type ReactNode } from 'react';
import './modal.css';

/**
 * A dialog over the page.
 *
 * It exists because of a real failure: the "losse uiting" form used to render
 * inside the card the request came from, and on the Kansen tab that card is a
 * narrow grid column far above the fold. Clicking looked like nothing
 * happened, while the form sat off-screen at 153 pixels wide (2026-09-15).
 * Anything that continues a choice the user just made belongs in the same
 * place that choice was made: on top, in full width.
 *
 * The minimum a modal owes a keyboard user: focus moves in on open, Escape
 * closes, a click outside closes, and focus returns to whatever opened it.
 */
export function Modal(props: {
  labelledBy: string;
  onClose: () => void;
  /** Blocks closing while something irreversible is in flight. */
  busy?: boolean | undefined;
  children: ReactNode;
}): ReactNode {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    const focusable = panelRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && props.busy !== true) props.onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      (openerRef.current as HTMLElement | null)?.focus?.();
    };
    // Mounted once per opening; the callbacks belong to that opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (props.busy !== true && !panelRef.current?.contains(event.target as Node)) props.onClose();
      }}
    >
      <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby={props.labelledBy} ref={panelRef}>
        {props.children}
      </div>
    </div>
  );
}
