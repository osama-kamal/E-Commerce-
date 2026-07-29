import { useEffect, useRef, useState } from 'react';

/**
 * Must match the transition-duration of `.theme-transition` in index.css.
 * The class is removed once the fade has finished so it never affects
 * ordinary interaction.
 */
const THEME_TRANSITION_MS = 300;

export function useDarkMode() {
  const [dark, setDark] = useState<boolean>(() => {
    const stored = localStorage.getItem('theme');
    if (stored) return stored === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // The effect also runs on mount, when the stored theme is applied for the
  // first time. Fading there would make the whole app visibly cross-fade on
  // every page load, so only user-initiated switches animate.
  const isInitialRun = useRef(true);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const root = document.documentElement;

    if (isInitialRun.current) {
      isInitialRun.current = false;
    } else {
      // Enable the colour fade only for the duration of this switch. Previously
      // an equivalent transition was applied globally and permanently, which
      // slowed down every hover and focus state in the application.
      window.clearTimeout(timerRef.current);
      root.classList.add('theme-transition');
      timerRef.current = window.setTimeout(() => {
        root.classList.remove('theme-transition');
      }, THEME_TRANSITION_MS);
    }

    if (dark) {
      root.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [dark]);

  // Clear any pending timer so the class is never toggled after unmount.
  useEffect(() => {
    return () => {
      window.clearTimeout(timerRef.current);
      document.documentElement.classList.remove('theme-transition');
    };
  }, []);

  return { dark, toggle: () => setDark(d => !d) };
}
