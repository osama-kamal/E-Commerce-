/**
 * Regression tests for theme switching.
 *
 * index.css previously applied a 500ms colour transition to `*`, `*::before`
 * and `*::after` unconditionally. Every hover, focus ring and link state in the
 * app therefore took half a second to settle — the single largest source of
 * "unresponsive" feel.
 *
 * The transition is now scoped to a `.theme-transition` class that this hook
 * adds only for the duration of an actual theme switch. These tests pin that
 * behaviour so the global rule cannot be reintroduced by accident.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDarkMode } from './useDarkMode';

const root = () => document.documentElement;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  root().className = '';
  // jsdom has no matchMedia by default.
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  vi.useRealTimers();
  root().className = '';
});

describe('initial mount', () => {
  it('does NOT fade on first render', () => {
    // Fading here would cross-fade the whole app on every page load.
    renderHook(() => useDarkMode());
    expect(root().classList.contains('theme-transition')).toBe(false);
  });

  it('applies the stored theme without animating', () => {
    localStorage.setItem('theme', 'dark');
    renderHook(() => useDarkMode());

    expect(root().classList.contains('dark')).toBe(true);
    expect(root().classList.contains('theme-transition')).toBe(false);
  });

  it('falls back to the OS preference when nothing is stored', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    const { result } = renderHook(() => useDarkMode());
    expect(result.current.dark).toBe(true);
  });
});

describe('user-initiated switch', () => {
  it('enables the fade while switching', () => {
    const { result } = renderHook(() => useDarkMode());

    act(() => { result.current.toggle(); });

    expect(root().classList.contains('theme-transition')).toBe(true);
  });

  it('removes the fade once the switch has finished', () => {
    const { result } = renderHook(() => useDarkMode());
    act(() => { result.current.toggle(); });

    act(() => { vi.advanceTimersByTime(300); });

    // Critical: if this class persisted, every hover would be slowed again.
    expect(root().classList.contains('theme-transition')).toBe(false);
  });

  it('still toggles the dark class', () => {
    const { result } = renderHook(() => useDarkMode());
    expect(root().classList.contains('dark')).toBe(false);

    act(() => { result.current.toggle(); });
    expect(root().classList.contains('dark')).toBe(true);

    act(() => { result.current.toggle(); });
    expect(root().classList.contains('dark')).toBe(false);
  });

  it('persists the choice to localStorage', () => {
    const { result } = renderHook(() => useDarkMode());

    act(() => { result.current.toggle(); });
    expect(localStorage.getItem('theme')).toBe('dark');

    act(() => { vi.advanceTimersByTime(300); result.current.toggle(); });
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('restarts the window on a rapid second toggle rather than ending early', () => {
    const { result } = renderHook(() => useDarkMode());

    act(() => { result.current.toggle(); });
    act(() => { vi.advanceTimersByTime(200); result.current.toggle(); });

    // The first timer must not strip the class mid-way through the second fade.
    act(() => { vi.advanceTimersByTime(150); });
    expect(root().classList.contains('theme-transition')).toBe(true);

    act(() => { vi.advanceTimersByTime(200); });
    expect(root().classList.contains('theme-transition')).toBe(false);
  });
});

describe('cleanup', () => {
  it('clears the transition class on unmount', () => {
    const { result, unmount } = renderHook(() => useDarkMode());
    act(() => { result.current.toggle(); });
    expect(root().classList.contains('theme-transition')).toBe(true);

    unmount();

    expect(root().classList.contains('theme-transition')).toBe(false);
  });
});
