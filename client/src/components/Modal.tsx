import { ReactNode, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

/**
 * Accessible modal dialog.
 *
 * Every modal in the app previously rendered its own `fixed inset-0` overlay with
 * a backdrop click handler and nothing else: no dialog role, no Escape key, no
 * focus management, no scroll lock. A keyboard user could Tab straight out of an
 * open dialog into the page behind it, and a screen-reader user was never told a
 * dialog had opened.
 *
 * This component owns those behaviours in one place. It deliberately does NOT own
 * layout: `panelClassName` and `backdropClassName` are passed through by each call
 * site so the existing appearance is preserved exactly.
 */

/**
 * Elements that can hold focus. `:not([disabled])` matters because a disabled
 * submit button is a very common last element in these forms — trapping onto it
 * would strand the user.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Visibility test used to skip focusable-but-invisible controls — the image
 * upload dialog, for example, hides its real <input type="file"> behind a styled
 * label, and focusing it would strand the keyboard user on an invisible control.
 *
 * Deliberately uses getComputedStyle rather than `offsetParent`/`getClientRects`:
 * jsdom performs no layout, so those always report "invisible" there and every
 * element would be filtered out under test.
 */
function isVisible(el: HTMLElement): boolean {
  if (el.hidden) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ).filter(isVisible);
}

export interface ModalProps {
  /** Called for Escape, backdrop click, and any close control inside `children`. */
  onClose: () => void;
  children: ReactNode;

  /**
   * id of the element naming this dialog — normally the existing <h2>. Screen
   * readers announce it when the dialog opens. Use `label` instead when the
   * dialog has no visible heading.
   */
  labelledBy?: string;
  /** id of the element describing the dialog, announced after the name. */
  describedBy?: string;
  /** Accessible name when there is no visible heading to point `labelledBy` at. */
  label?: string;

  /** Classes for the dialog panel. Passed through so each modal keeps its own size and shape. */
  panelClassName?: string;
  containerClassName?: string;
  backdropClassName?: string;

  /** Set false for flows where a stray click must not discard work. */
  closeOnBackdropClick?: boolean;
  /** Set false where dismissing mid-flow would be destructive. */
  closeOnEscape?: boolean;

  /**
   * Element to focus when the dialog opens. Defaults to the first focusable
   * element in the panel, which is what a sighted user's eye lands on anyway.
   */
  initialFocusRef?: React.RefObject<HTMLElement>;

  /** Opt out of the entrance animation for dialogs that never had one. */
  animate?: boolean;
}

export default function Modal({
  onClose,
  children,
  labelledBy,
  describedBy,
  label,
  panelClassName = 'relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md',
  containerClassName = 'fixed inset-0 z-50 flex items-center justify-center p-4',
  backdropClassName = 'absolute inset-0 bg-black/50 backdrop-blur-sm',
  closeOnBackdropClick = true,
  closeOnEscape = true,
  initialFocusRef,
  animate = true,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * The element that had focus before the dialog opened — captured during the
   * first render pass rather than in an effect, because by the time effects run
   * React may already have moved focus.
   */
  const triggerRef = useRef<Element | null>(
    typeof document !== 'undefined' ? document.activeElement : null
  );

  // ── Body scroll lock ────────────────────────────────────────────────────────
  // Without this the page behind scrolls when the dialog is scrolled past its
  // end, and on touch devices the background moves under the overlay.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // ── Initial focus ───────────────────────────────────────────────────────────
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    // Deferred a frame so framer-motion has committed the panel and any
    // conditionally rendered children are present before we look for a target.
    const id = requestAnimationFrame(() => {
      // If focus already landed inside the dialog, leave it there. Some forms
      // mark their first field `autoFocus`; overriding that would drag the user
      // back to the close button and undo a deliberate choice by the call site.
      if (panel.contains(document.activeElement)) return;

      const target = initialFocusRef?.current ?? getFocusable(panel)[0] ?? panel;
      target.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [initialFocusRef]);

  // ── Restore focus on unmount ────────────────────────────────────────────────
  // Separate effect with an empty dep list so it runs exactly once, on close.
  useEffect(() => {
    return () => {
      const trigger = triggerRef.current;
      // Guard against the trigger having been removed from the DOM while the
      // dialog was open — focusing a detached node silently sends focus to
      // <body>, which drops the user back at the top of the page.
      if (
        trigger instanceof HTMLElement &&
        document.contains(trigger) &&
        typeof trigger.focus === 'function'
      ) {
        trigger.focus();
      }
    };
  }, []);

  // ── Escape + focus trap ─────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEscape) {
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusable = getFocusable(panel);
      if (focusable.length === 0) {
        // Nothing to cycle through — keep focus on the panel rather than letting
        // Tab escape to the page behind.
        e.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (active instanceof Node && !panel.contains(active)) {
        // Focus escaped the dialog (browser chrome, an extension, a stale node).
        // Pull it back to the top of the dialog.
        e.preventDefault();
        first.focus();
      }
    },
    [onClose, closeOnEscape]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const motionBackdrop = animate
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {};
  const motionPanel = animate
    ? {
        initial: { opacity: 0, scale: 0.95, y: 20 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.95, y: 20 },
        transition: { duration: 0.2 },
      }
    : {};

  return (
    <div className={containerClassName}>
      {/* Decorative: the same dismiss action is always available via Escape and a
          close control inside the panel, so this must not be announced. */}
      <motion.div
        {...motionBackdrop}
        aria-hidden="true"
        className={backdropClassName}
        onClick={closeOnBackdropClick ? onClose : undefined}
      />

      <motion.div
        {...motionPanel}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-label={labelledBy ? undefined : label}
        // Lets the panel itself receive focus as a fallback when it contains no
        // focusable children, without adding it to the tab order.
        tabIndex={-1}
        className={panelClassName}
      >
        {children}
      </motion.div>
    </div>
  );
}
