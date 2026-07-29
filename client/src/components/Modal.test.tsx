/**
 * Contract tests for the shared Modal.
 *
 * Every modal in the app previously shipped an overlay with a backdrop click
 * handler and nothing else — no dialog role, no Escape, no focus management. These
 * tests pin the behaviours that replaced that, so a future refactor cannot quietly
 * drop them again.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import Modal from './Modal';

// framer-motion drives entrance transitions off rAF; jsdom provides it, but the
// initial-focus effect also defers a frame, so tests await focus via waitFor.

afterEach(cleanup);

function Fixture({
  onClose = () => {},
  ...props
}: Partial<React.ComponentProps<typeof Modal>> = {}) {
  return (
    <Modal onClose={onClose} labelledBy="t" {...props}>
      <h2 id="t">Dialog title</h2>
      <button>First</button>
      <button>Second</button>
      <button>Last</button>
    </Modal>
  );
}

describe('dialog semantics', () => {
  // Native assertions throughout: this project registers no jest-dom matchers
  // (vitest.config.ts declares no setupFiles), matching the existing suites.
  it('exposes role="dialog" and aria-modal="true"', () => {
    render(<Fixture />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('names the dialog from the heading via aria-labelledby', () => {
    render(<Fixture />);
    // getByRole with `name` resolves the accessible name through aria-labelledby,
    // so this passing proves the wiring, not just the attribute's presence.
    expect(screen.getByRole('dialog', { name: 'Dialog title' })).toBeTruthy();
  });

  it('falls back to aria-label when there is no heading to point at', () => {
    render(
      <Modal onClose={() => {}} label="Standalone name">
        <button>Only</button>
      </Modal>
    );
    expect(screen.getByRole('dialog', { name: 'Standalone name' })).toBeTruthy();
  });

  it('supports aria-describedby', () => {
    render(
      <Modal onClose={() => {}} labelledBy="t" describedBy="d">
        <h2 id="t">Title</h2>
        <p id="d">Extra description</p>
      </Modal>
    );
    expect(screen.getByRole('dialog').getAttribute('aria-describedby')).toBe('d');
  });

  it('hides the backdrop from assistive tech', () => {
    const { container } = render(<Fixture />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });
});

describe('escape key', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<Fixture onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on Escape when closeOnEscape is false', () => {
    const onClose = vi.fn();
    render(<Fixture onClose={onClose} closeOnEscape={false} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores other keys', () => {
    const onClose = vi.fn();
    render(<Fixture onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'a' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('backdrop', () => {
  it('closes on backdrop click by default', () => {
    const onClose = vi.fn();
    const { container } = render(<Fixture onClose={onClose} />);
    fireEvent.click(container.querySelector('[aria-hidden="true"]')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on backdrop click when disabled', () => {
    const onClose = vi.fn();
    const { container } = render(<Fixture onClose={onClose} closeOnBackdropClick={false} />);
    fireEvent.click(container.querySelector('[aria-hidden="true"]')!);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('background scroll lock', () => {
  beforeEach(() => { document.body.style.overflow = ''; });

  it('locks body scroll while open', () => {
    render(<Fixture />);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores the previous overflow on close', () => {
    document.body.style.overflow = 'scroll';
    const { unmount } = render(<Fixture />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('scroll');
  });
});

describe('initial focus', () => {
  it('focuses the first focusable element', async () => {
    render(<Fixture />);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }));
    });
  });

  it('honours initialFocusRef over the first element', async () => {
    function WithRef() {
      const ref = { current: null } as React.RefObject<HTMLButtonElement>;
      return (
        <Modal onClose={() => {}} label="x" initialFocusRef={ref}>
          <button>First</button>
          <button ref={ref as React.RefObject<HTMLButtonElement>}>Target</button>
        </Modal>
      );
    }
    render(<WithRef />);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Target' }));
    });
  });

  it('respects autoFocus already inside the dialog', async () => {
    // AdminCategories marks its first field autoFocus; stealing that back to the
    // close button would be a regression against the pre-migration behaviour.
    render(
      <Modal onClose={() => {}} label="form">
        <button>Close</button>
        <input autoFocus aria-label="Name" />
      </Modal>
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' }));
    });
  });

  it('falls back to the panel when nothing inside is focusable', async () => {
    render(
      <Modal onClose={() => {}} label="empty">
        <p>Nothing to focus</p>
      </Modal>
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('dialog'));
    });
  });

  it('skips hidden controls — a display:none file input must not take focus', async () => {
    render(
      <Modal onClose={() => {}} label="upload">
        <input type="file" style={{ display: 'none' }} aria-label="file" />
        <button>Choose</button>
      </Modal>
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Choose' }));
    });
  });
});

describe('focus trap', () => {
  it('wraps Tab from the last element back to the first', async () => {
    render(<Fixture />);
    const last = screen.getByRole('button', { name: 'Last' });
    const first = screen.getByRole('button', { name: 'First' });

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    await waitFor(() => expect(document.activeElement).toBe(first));
  });

  it('wraps Shift+Tab from the first element back to the last', async () => {
    render(<Fixture />);
    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });

    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    await waitFor(() => expect(document.activeElement).toBe(last));
  });

  it('pulls focus back when it has escaped the dialog', async () => {
    const outside = document.createElement('button');
    outside.textContent = 'Outside';
    document.body.appendChild(outside);

    render(<Fixture />);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    fireEvent.keyDown(document, { key: 'Tab' });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }));
    });

    outside.remove();
  });

  it('leaves interior Tab steps to the browser', () => {
    render(<Fixture />);
    const first = screen.getByRole('button', { name: 'First' });
    first.focus();

    // Not on an edge, so the handler must not preventDefault — jsdom does not
    // move focus itself, so asserting focus is unchanged proves we did not
    // hijack the step.
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(first);
  });
});

describe('focus restoration', () => {
  it('returns focus to the element that was focused before opening', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(<Fixture />);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }));
    });

    unmount();
    expect(document.activeElement).toBe(trigger);

    trigger.remove();
  });

  it('does not throw when the trigger was removed while the dialog was open', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(<Fixture />);
    trigger.remove();

    expect(() => unmount()).not.toThrow();
  });
});
