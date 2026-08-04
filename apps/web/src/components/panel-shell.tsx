import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * Wraps a dense panel with an optional pop-out view, without ever unmounting the panel it
 * wraps.
 *
 * The panel body is rendered exactly once, in exactly one place in the tree; "expanded" only
 * changes its own CSS position (normal flow versus a fixed full-viewport layer) and whether
 * the rest of the page is `inert`. A version that mounted a second copy for the overlay would
 * either fork the search text and scroll position the user was mid-way through, or expose two
 * "Draft" buttons for the same player to assistive tech -- both of which the caller already
 * decided against by choosing this shape over a duplicated one.
 */
export function PanelShell({
  title,
  toneClassName,
  expanded,
  onExpand,
  onClose,
  children,
}: {
  title: ReactNode;
  toneClassName?: string;
  expanded: boolean;
  onExpand: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const wasExpandedRef = useRef(false);

  // Moves focus into the popout when it opens, and back to the control that opened it when it
  // closes -- so closing never strands keyboard focus on a control that just disappeared.
  useEffect(() => {
    if (expanded) {
      headingRef.current?.focus();
    } else if (wasExpandedRef.current) {
      expandButtonRef.current?.focus();
    }
    wasExpandedRef.current = expanded;
  }, [expanded]);

  useEffect(() => {
    if (!expanded) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [expanded, onClose]);

  // The popout covers the viewport itself, so the page behind it must stop scrolling too --
  // otherwise a touch drag on what looks like the popout's edge can scroll the dashboard
  // underneath it.
  useEffect(() => {
    if (!expanded) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [expanded]);

  return (
    <section
      className={`panel${toneClassName ? ` ${toneClassName}` : ''}${expanded ? ' panel-popout' : ''}`}
      role={expanded ? 'dialog' : undefined}
      aria-modal={expanded ? 'true' : undefined}
      aria-labelledby={expanded ? headingId : undefined}
    >
      <div className="panel-shell-head">
        <h2 id={headingId} tabIndex={-1} ref={headingRef}>
          {title}
        </h2>
        {expanded ? (
          <button type="button" className="panel-shell-close" onClick={onClose}>
            Close
          </button>
        ) : (
          <button
            type="button"
            ref={expandButtonRef}
            className="panel-shell-expand"
            onClick={onExpand}
            aria-label={typeof title === 'string' ? `Expand ${title}` : 'Expand panel'}
          >
            Expand
          </button>
        )}
      </div>
      {children}
    </section>
  );
}
