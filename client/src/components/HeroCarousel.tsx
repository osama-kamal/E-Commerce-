import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

// ── Slide data ─────────────────────────────────────────────────────────────────
// fm=webp appended to every URL — Unsplash serves WebP natively when requested.
// WebP is ~30% smaller than JPEG at equivalent quality, directly reducing LCP.
//
// Copy is unchanged from the previous design, only re-ranked: the emoji that
// prefixed each title became the `eyebrow` label, and the old subtitle was
// promoted to the headline because it is the line that actually says something.
// Emoji were dropped from headings — they render differently on every OS and
// were the loudest "unfinished" signal in the old hero.
const slides = [
  {
    id: 1,
    eyebrow: 'Featured',
    title: 'Discover Our Amazing Collection',
    image: 'https://images.unsplash.com/photo-1595665593673-bf1ad72905c0?q=80&w=1328&auto=format&fit=crop&fm=webp&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
    cta: 'Shop Now',
    alt: 'A bright, well-stocked retail store interior',
  },
  {
    id: 2,
    eyebrow: 'Hot Deals',
    title: 'Up to 50% Off on Selected Items',
    image: 'https://images.unsplash.com/photo-1558769132-cb1aea458c5e?q=80&w=1074&auto=format&fit=crop&fm=webp&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
    cta: 'See Deals',
    alt: 'Colorful shopping bags and sale tags',
  },
  {
    id: 3,
    eyebrow: 'Fashion Week',
    title: 'Trending Styles for Every Occasion',
    image: 'https://images.unsplash.com/photo-1705675451868-014a161e591b?q=80&w=735&auto=format&fit=crop&fm=webp&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
    cta: 'Explore',
    alt: 'Fashion clothing displayed on hangers',
  },
  {
    id: 4,
    eyebrow: 'Tech Essentials',
    title: 'Latest Gadgets and Electronics',
    image: 'https://images.unsplash.com/photo-1657812159103-1b2a52a7f5e8?w=600&auto=format&fit=crop&fm=webp&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8NDN8fGUlMjBjb21tZXJjZXxlbnwwfHwwfHx8MA%3D%3D',
    cta: 'Shop Tech',
    alt: 'Laptop and modern tech gadgets on a desk',
  },
  {
    id: 5,
    eyebrow: 'Special Offers',
    title: 'Exclusive Deals Just for You',
    image: 'https://images.unsplash.com/photo-1763872038252-e6c4e0a11067?w=600&auto=format&fit=crop&fm=webp&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8OTR8fGUlMjBjb21tZXJjZXxlbnwwfHwwfHx8MA%3D%3D',
    cta: 'Claim Now',
    alt: 'Gift boxes wrapped with colorful ribbons',
  },
];

// How many slides on either side of the active slide to keep mounted.
// 1 means: render active - 1, active, active + 1. Others are unmounted (no img fetch).
const RENDER_WINDOW = 1;
const SLIDE_MS = 4000;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Counts from 0 to `value` once, on mount.
 *
 * Jumps straight to the final number when the user has asked for reduced
 * motion — a ticking number is exactly the kind of ambient movement that
 * setting exists to stop.
 */
function useCountUp(value: number, duration = 1100) {
  const [n, setN] = useState(() => (prefersReducedMotion() ? value : 0));

  useEffect(() => {
    if (prefersReducedMotion()) {
      setN(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutExpo — fast start, long settle, so the final digits are readable.
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setN(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return n;
}

/** A floating glass statistic. Values are supplied by the caller — never invented here. */
function StatCard({ value, label, suffix = '', delay }: {
  value: number; label: string; suffix?: string; delay: string;
}) {
  const n = useCountUp(value);
  return (
    <div
      className="glass rounded-2xl px-5 py-3.5 text-white animate-rise-in"
      style={{ animationDelay: delay }}
    >
      <p className="text-2xl font-bold tabular-nums leading-none">
        {n.toLocaleString()}{suffix}
      </p>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-white/70">
        {label}
      </p>
    </div>
  );
}

export interface HeroStat {
  value: number;
  label: string;
  suffix?: string;
}

export default function HeroCarousel({ stats }: { stats?: HeroStat[] } = {}) {
  const [, setSearchParams] = useSearchParams();
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const regionRef = useRef<HTMLElement>(null);

  const next = useCallback(() => setCurrent(c => (c + 1) % slides.length), []);
  const prev = () => setCurrent(c => (c - 1 + slides.length) % slides.length);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(next, SLIDE_MS);
    return () => clearInterval(t);
  }, [paused, next]);

  // Unchanged behaviour: clear filters, then scroll the product grid into view.
  const handleCTA = () => {
    setSearchParams({}, { replace: true });
    setTimeout(() => {
      document.querySelector('[data-products-section]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  // Arrow-key navigation. The carousel was previously reachable by Tab but the
  // slides could only be changed by clicking — standard behaviour for a
  // roving carousel is that Left/Right move between slides.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
  };

  const active = slides[current];

  return (
    <section
      ref={regionRef}
      role="region"
      aria-roledescription="carousel"
      aria-label="Featured promotions"
      onKeyDown={onKeyDown}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="relative w-full overflow-hidden rounded-3xl shadow-float
                 min-h-[440px] sm:min-h-[520px] lg:min-h-[600px]"
    >
      {/* Slide track */}
      <div
        className="absolute inset-0 flex transition-transform duration-[900ms]
                   [transition-timing-function:cubic-bezier(.16,1,.3,1)]"
        style={{ width: `${slides.length * 100}%`, transform: `translateX(-${(current * 100) / slides.length}%)` }}
      >
        {slides.map((sl, i) => {
          // Only mount slides within the render window around the active slide.
          // Slides outside this range are replaced with a lightweight placeholder
          // div that holds the same dimensions, keeping the CSS transform math
          // correct without triggering any image fetches.
          const distance = Math.min(
            Math.abs(i - current),
            slides.length - Math.abs(i - current) // wrap-around distance
          );
          const isMounted = distance <= RENDER_WINDOW;

          return (
            <div
              key={sl.id}
              className="relative h-full flex-shrink-0"
              style={{ width: `${100 / slides.length}%` }}
              aria-hidden={i !== current}
            >
              {isMounted ? (
                <>
                  {/* fetchpriority (lowercase) is the correct HTML attribute name.
                      React 18 types only expose camelCase fetchPriority which warns
                      at runtime, so we spread it as an untyped extra prop instead. */}
                  <img
                    src={sl.image}
                    alt={sl.alt}
                    className="absolute inset-0 h-full w-full object-cover"
                    loading={i === 0 ? 'eager' : 'lazy'}
                    decoding="async"
                    width="1600"
                    height="600"
                    {...({ fetchpriority: i === 0 ? 'high' : 'auto' } as object)}
                  />
                  {/* Two-axis scrim. The old single `from-black/70` bar dimmed the
                      photograph uniformly and looked like a filter; this keeps the
                      image bright on the right while guaranteeing text contrast
                      on the left, and the bottom pass anchors the controls. */}
                  <div className="absolute inset-0 bg-gradient-to-r from-gray-950/92 via-gray-950/55 to-gray-950/10" />
                  <div className="absolute inset-0 bg-gradient-to-t from-gray-950/75 via-transparent to-transparent" />
                  {/* Warm brand wash tying the photography to the storefront accent. */}
                  <div className="absolute inset-0 bg-gradient-to-tr from-amber-500/12 via-transparent to-transparent" />
                </>
              ) : (
                // Unmounted placeholder — no img tag, no network request.
                <div className="absolute inset-0 bg-gray-950" aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>

      {/* ── Foreground content ──────────────────────────────────────────────
          Sits outside the sliding track so the copy cross-fades in place
          instead of being dragged sideways with the photograph. Keyed on
          `current` so the entrance animation replays for each slide. */}
      <div className="relative flex min-h-[440px] sm:min-h-[520px] lg:min-h-[600px] items-center">
        <div key={current} className="w-full px-6 sm:px-12 lg:px-20 py-14">
          <div className="max-w-2xl">
            <div className="animate-rise-in flex items-center gap-3" style={{ animationDelay: '60ms' }}>
              <span className="h-px w-10 bg-gradient-to-r from-amber-400 to-yellow-500" aria-hidden="true" />
              <span className="eyebrow text-amber-300">{active.eyebrow}</span>
            </div>

            <h2
              className="animate-rise-in mt-5 text-white text-[2rem] leading-[1.08] tracking-[-0.02em] font-extrabold
                         sm:text-display-sm lg:text-display-md"
              style={{ animationDelay: '140ms' }}
            >
              {active.title}
            </h2>

            <div
              className="animate-rise-in mt-8 flex flex-wrap items-center gap-3"
              style={{ animationDelay: '220ms' }}
            >
              <button onClick={handleCTA} className="btn btn-brand btn-lg shadow-brand">
                {active.cta}
                <span aria-hidden="true">→</span>
              </button>
              <button
                onClick={handleCTA}
                className="btn btn-lg glass rounded-lg text-white hover:bg-white/20"
              >
                Browse all products
              </button>
            </div>

            {/* Real figures passed in by the page — this component never
                fabricates a statistic. Renders nothing when none are given. */}
            {stats && stats.length > 0 && (
              <div className="mt-10 hidden flex-wrap gap-3 sm:flex">
                {stats.map((s, i) => (
                  <StatCard
                    key={s.label}
                    value={s.value}
                    label={s.label}
                    suffix={s.suffix}
                    delay={`${300 + i * 90}ms`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Controls ────────────────────────────────────────────────────────── */}
      <button
        onClick={prev}
        aria-label="Previous slide"
        className="glass absolute left-4 top-1/2 z-10 hidden h-12 w-12 -translate-y-1/2 items-center justify-center
                   rounded-full text-2xl text-white transition-all hover:scale-105 hover:bg-white/20 sm:flex"
      >
        ‹
      </button>
      <button
        onClick={next}
        aria-label="Next slide"
        className="glass absolute right-4 top-1/2 z-10 hidden h-12 w-12 -translate-y-1/2 items-center justify-center
                   rounded-full text-2xl text-white transition-all hover:scale-105 hover:bg-white/20 sm:flex"
      >
        ›
      </button>

      {/* Line indicators — a filled bar reads as progress where a dot only reads
          as position, and it gives the autoplay a visible rhythm. */}
      <div
        className="absolute bottom-7 left-6 z-10 flex items-center gap-2 sm:left-12 lg:left-20"
        role="tablist"
        aria-label="Slide indicators"
      >
        {slides.map((_, i) => (
          <button
            key={i}
            role="tab"
            aria-selected={i === current}
            aria-label={`Go to slide ${i + 1}`}
            onClick={() => setCurrent(i)}
            className={`h-1.5 cursor-pointer rounded-full border-none transition-all duration-500 ${
              i === current
                ? 'w-10 bg-gradient-to-r from-amber-400 to-yellow-500'
                : 'w-4 bg-white/35 hover:bg-white/60'
            }`}
          />
        ))}
        <span className="ml-3 text-xs font-medium tabular-nums text-white/60" aria-live="polite">
          {String(current + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}
        </span>
      </div>
    </section>
  );
}
