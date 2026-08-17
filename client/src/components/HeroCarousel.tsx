import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Promotional hero carousel.
 *
 * ── Shape ─────────────────────────────────────────────────────────────────────
 * One sliding track holds the photography; the copy sits OUTSIDE the track and
 * is keyed on the active index, so headlines cross-fade in place rather than
 * being dragged sideways with the image. That difference is most of why this
 * reads as a designed hero rather than a slideshow.
 *
 * ── Two palettes ──────────────────────────────────────────────────────────────
 * `accent="brand"` (default) keeps the amber treatment the platform marketing
 * page uses. `accent="neutral"` drops it for the white/near-black storefront
 * aesthetic. The prop exists because the same component now serves both, and
 * hardcoding one palette is what made this unusable on the storefront.
 *
 * ── Cost ──────────────────────────────────────────────────────────────────────
 * Only slides within RENDER_WINDOW of the active index are mounted; the rest
 * are placeholder divs holding the same width, so the transform math stays
 * correct while no image outside the window is ever fetched. The first image is
 * eager + high priority (it is the LCP element); every other is lazy.
 */

export interface HeroSlide {
  id: number | string;
  eyebrow: string;
  title: string;
  image: string;
  alt: string;
  cta: string;
  /** Where the CTA goes. Falls back to the scroll-to-products behaviour. */
  href?: string;
}

// fm=webp appended to every URL — Unsplash serves WebP natively when requested.
// WebP is ~30% smaller than JPEG at equivalent quality, directly reducing LCP.
const DEFAULT_SLIDES: HeroSlide[] = [
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

const RENDER_WINDOW = 1;
const SLIDE_MS = 5000;
/** Horizontal travel, in px, that counts as a swipe rather than a tap. */
const SWIPE_THRESHOLD = 50;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

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
    <div className="glass rounded-2xl px-5 py-3.5 text-white animate-rise-in" style={{ animationDelay: delay }}>
      <p className="text-2xl font-bold tabular-nums leading-none">
        {n.toLocaleString()}{suffix}
      </p>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-white/70">{label}</p>
    </div>
  );
}

export interface HeroStat {
  value: number;
  label: string;
  suffix?: string;
}

export default function HeroCarousel({
  slides = DEFAULT_SLIDES,
  stats,
  fullBleed = false,
  accent = 'brand',
  height = 'tall',
  shellClass = 'max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8',
}: {
  slides?: HeroSlide[];
  stats?: HeroStat[];
  fullBleed?: boolean;
  accent?: 'brand' | 'neutral';
  /** `tall` for a landing page; `compact` above a catalogue, where the grid is the point. */
  height?: 'tall' | 'compact';
  /**
   * The horizontal shell the headline and indicators sit inside.
   *
   * A hero's copy has to start on the same vertical line as the content below
   * it, and this component now serves two pages whose containers are different
   * widths — so the caller owns it. The default reproduces the width this had
   * before the prop existed, which is what the marketing page still uses; the
   * storefront passes `storefront-shell`.
   */
  shellClass?: string;
} = {}) {
  const [, setSearchParams] = useSearchParams();
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const regionRef = useRef<HTMLElement>(null);
  const dragStartX = useRef<number | null>(null);

  const count = slides.length;
  const neutral = accent === 'neutral';

  const next = useCallback(() => setCurrent(c => (c + 1) % count), [count]);
  const prev = useCallback(() => setCurrent(c => (c - 1 + count) % count), [count]);

  // Autoplay.
  //
  // Suspended entirely under `prefers-reduced-motion`. A carousel that advances
  // on its own is the canonical example of the motion that setting exists to
  // stop, and honouring it only for the stat counters (as this did) misses the
  // large moving thing on the page. Controls still work; nothing moves unbidden.
  useEffect(() => {
    if (paused || count <= 1 || prefersReducedMotion()) return;
    const t = setInterval(next, SLIDE_MS);
    return () => clearInterval(t);
  }, [paused, next, count]);

  // Fallback CTA: clear filters, then scroll the product grid into view. Used
  // only when a slide supplies no `href`.
  const handleCTA = () => {
    setSearchParams({}, { replace: true });
    setTimeout(() => {
      document.querySelector('[data-products-section]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
  };

  // ── Swipe ───────────────────────────────────────────────────────────────────
  // Pointer events rather than touch events, so this covers finger, pen and a
  // click-drag with a mouse from one handler. The threshold keeps a sloppy tap
  // on the CTA from being read as a swipe.
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragStartX.current = e.clientX;
    setPaused(true);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const start = dragStartX.current;
    dragStartX.current = null;
    setPaused(false);
    if (start === null) return;
    const dx = e.clientX - start;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;
    if (dx < 0) next(); else prev();
  };

  const active = slides[current];

  /**
   * Height is an ASPECT RATIO with clamps, not a fixed min-height.
   *
   * The banner art is ~16:9 (1328×749). A fixed 460px box at 1905px wide is a
   * 3.1:1 window onto it, so `object-cover` scaled the image to 1074px tall and
   * threw away 57% of it — the subject of every photograph was cropped out.
   * Worse at the other end: on a 375px phone the same box is nearly square, so
   * the crop moved to the horizontal axis and cut ~38% off the sides.
   *
   * Tying height to width keeps the frame near the source's own proportions at
   * every size, which is the only way to stop cropping without letterboxing.
   * The ratio widens as the viewport does — a phone can afford a squarer,
   * taller banner; a 24" monitor cannot, or the grid never appears above the
   * fold. `max-h` is the backstop for ultrawide displays.
   */
  const frame = height === 'compact'
    ? 'aspect-[4/3] sm:aspect-[16/9] lg:aspect-[21/8] min-h-[300px] max-h-[620px]'
    : 'aspect-[4/3] sm:aspect-[16/9] lg:aspect-[2/1] min-h-[420px] max-h-[820px]';

  const ctaClasses = neutral
    ? 'inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-100'
    : 'btn btn-brand btn-lg shadow-brand';

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
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { dragStartX.current = null; setPaused(false); }}
      // `touch-pan-y` keeps vertical page scrolling native while horizontal
      // drags reach the pointer handlers above; `select-none` stops a swipe from
      // painting a text selection across the headline.
      className={`relative w-full overflow-hidden touch-pan-y select-none ${frame} ${
        fullBleed ? '' : 'rounded-3xl shadow-float'
      }`}
    >
      {/* Slide track */}
      <div
        className="absolute inset-0 flex transition-transform duration-[900ms]
                   [transition-timing-function:cubic-bezier(.16,1,.3,1)]
                   motion-reduce:transition-none"
        style={{ width: `${count * 100}%`, transform: `translateX(-${(current * 100) / count}%)` }}
      >
        {slides.map((sl, i) => {
          // Only mount slides within the render window around the active slide.
          // Others become a lightweight placeholder that holds the same width,
          // keeping the transform math correct with no image fetch.
          const distance = Math.min(
            Math.abs(i - current),
            count - Math.abs(i - current) // wrap-around distance
          );
          const isMounted = distance <= RENDER_WINDOW;

          return (
            <div
              key={sl.id}
              className="relative h-full flex-shrink-0"
              style={{ width: `${100 / count}%` }}
              aria-hidden={i !== current}
            >
              {isMounted ? (
                <>
                  {/* fetchpriority (lowercase) is the correct HTML attribute name.
                      React 18 types only expose camelCase fetchPriority, which
                      warns at runtime, so it is spread as an untyped prop. */}
                  <img
                    src={sl.image}
                    alt={sl.alt}
                    className="absolute inset-0 h-full w-full object-cover"
                    loading={i === 0 ? 'eager' : 'lazy'}
                    decoding="async"
                    draggable={false}
                    width="1600"
                    height="600"
                    {...({ fetchpriority: i === 0 ? 'high' : 'auto' } as object)}
                  />
                  {/* Two-axis scrim: keeps the photograph bright on the right
                      while guaranteeing text contrast on the left, with a bottom
                      pass to anchor the controls. */}
                  <div className="absolute inset-0 bg-gradient-to-r from-gray-950/92 via-gray-950/55 to-gray-950/10" />
                  <div className="absolute inset-0 bg-gradient-to-t from-gray-950/75 via-transparent to-transparent" />
                  {!neutral && (
                    <div className="absolute inset-0 bg-gradient-to-tr from-amber-500/12 via-transparent to-transparent" />
                  )}
                </>
              ) : (
                <div className="absolute inset-0 bg-gray-950" aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>

      {/* ── Foreground copy ─────────────────────────────────────────────────
          Outside the track, keyed on `current`, so it cross-fades in place. */}
      {/* Copy layer.
          `absolute inset-0` now that the section's height comes from its aspect
          ratio — re-declaring a height here would fight it.

          The inner wrapper matches the page container exactly (`shellClass`,
          supplied by the caller), so the headline starts on the same vertical
          line as the filter rail and product grid below. It previously used its
          own `px-6 sm:px-12 lg:px-20`, which at 1920px put the headline at x=80
          while the grid began at x=184 — a 104px misalignment that read as the
          hero not belonging to the page. */}
      <div className="absolute inset-0 flex items-center">
        <div key={current} className={`w-full py-10 ${shellClass}`}>
          <div className="max-w-2xl">
            <div className="animate-rise-in flex items-center gap-3" style={{ animationDelay: '60ms' }}>
              <span
                className={`h-px w-10 ${neutral ? 'bg-white/60' : 'bg-gradient-to-r from-amber-400 to-yellow-500'}`}
                aria-hidden="true"
              />
              <span className={`eyebrow ${neutral ? 'text-white/80' : 'text-amber-300'}`}>
                {active.eyebrow || 'Featured'}
              </span>
            </div>

            <h2
              className={`animate-rise-in mt-5 text-white leading-[1.08] tracking-[-0.02em] font-extrabold
                          ${height === 'compact'
                            ? 'text-[1.75rem] sm:text-[2.25rem] lg:text-[2.75rem]'
                            : 'text-[2rem] sm:text-display-sm lg:text-display-md'}`}
              style={{ animationDelay: '140ms' }}
            >
              {active.title}
            </h2>

            <div className="animate-rise-in mt-8 flex flex-wrap items-center gap-3" style={{ animationDelay: '220ms' }}>
              {active.href ? (
                <Link to={active.href} className={ctaClasses}>
                  {active.cta}
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </Link>
              ) : (
                <button onClick={handleCTA} className={ctaClasses}>
                  {active.cta}
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </div>

            {/* Real figures passed in by the page — never fabricated here. */}
            {stats && stats.length > 0 && (
              <div className="mt-10 hidden flex-wrap gap-3 sm:flex">
                {stats.map((s, i) => (
                  <StatCard key={s.label} value={s.value} label={s.label} suffix={s.suffix} delay={`${300 + i * 90}ms`} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Controls ───────────────────────────────────────────────────────── */}
      {count > 1 && (
        <>
          <button
            onClick={prev}
            aria-label="Previous slide"
            className="glass absolute left-4 top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center
                       rounded-full text-white transition-all hover:scale-105 hover:bg-white/20 sm:flex"
          >
            <ChevronLeft className="w-5 h-5" aria-hidden="true" />
          </button>
          <button
            onClick={next}
            aria-label="Next slide"
            className="glass absolute right-4 top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center
                       rounded-full text-white transition-all hover:scale-105 hover:bg-white/20 sm:flex"
          >
            <ChevronRight className="w-5 h-5" aria-hidden="true" />
          </button>

          {/* Line indicators — a filled bar reads as progress where a dot only
              reads as position, and it gives the autoplay a visible rhythm.
              Wrapped in the same container as the copy so they sit on the page's
              left margin rather than a padding value of their own. */}
          <div className="absolute bottom-7 inset-x-0 z-10">
          <div
            className={`flex items-center gap-2 ${shellClass}`}
            role="tablist"
            aria-label="Slide indicators"
          >
            {slides.map((sl, i) => (
              <button
                key={sl.id}
                role="tab"
                aria-selected={i === current}
                aria-label={`Go to slide ${i + 1}`}
                onClick={() => setCurrent(i)}
                // The visible bar stays 6px, but 20px of vertical padding
                // cancelled by an equal negative margin gives a ~46px tap target
                // (WCAG 2.5.5) without moving anything on screen.
                className="group -my-5 flex cursor-pointer items-center border-none bg-transparent py-5"
              >
                <span
                  className={`block h-1.5 rounded-full transition-all duration-200 ${
                    i === current
                      ? neutral ? 'w-10 bg-white' : 'w-10 bg-gradient-to-r from-amber-400 to-yellow-500'
                      : 'w-4 bg-white/35 group-hover:bg-white/60'
                  }`}
                />
              </button>
            ))}
            <span className="ml-3 text-xs font-medium tabular-nums text-white/60" aria-live="polite">
              {String(current + 1).padStart(2, '0')} / {String(count).padStart(2, '0')}
            </span>
          </div>
          </div>
        </>
      )}
    </section>
  );
}
