import { Star } from 'lucide-react';

/**
 * Star rating.
 *
 * ── Why not the `★` character ─────────────────────────────────────────────────
 * This rendered `★` as text. A text glyph takes its shape from whichever font
 * the platform resolves it in, so the same rating drew as a fat black star on
 * Windows, a thin outline on macOS and a colour emoji on some Android builds —
 * and it sits on the text baseline, which left the row visibly misaligned
 * against the review count beside it. A vector icon draws identically
 * everywhere and centres on its own box.
 *
 * Amber fill is kept deliberately. Star colour is one of the few genuinely
 * universal conventions in retail UI, and neutralising it to match a minimalist
 * palette costs more in recognition than it gains in restraint. It is the ONE
 * warm accent left on the storefront, and it now reads as a rating rather than
 * as part of a warm wash, because the page behind it is white.
 *
 * ── Accessibility ─────────────────────────────────────────────────────────────
 * The interactive variant was a row of `<span>`s with an onClick: not focusable,
 * not announced, unusable from a keyboard. It is now real `<button>`s with
 * labels. The read-only variant is a single labelled image node rather than five
 * meaningless stars, so a screen reader says "Rated 4.2 out of 5" once.
 */

interface Props {
  rating: number;
  max?: number;
  size?: 'sm' | 'md';
  interactive?: boolean;
  onChange?: (rating: number) => void;
}

export default function StarRating({
  rating,
  max = 5,
  size = 'md',
  interactive = false,
  onChange,
}: Props) {
  const px = size === 'sm' ? 'w-3.5 h-3.5' : 'w-5 h-5';

  const star = (index: number) => {
    const filled = index < Math.round(rating);
    return (
      <Star
        className={`${px} ${
          filled
            ? 'fill-amber-400 text-amber-400'
            : 'fill-transparent text-gray-300 dark:text-gray-600'
        }`}
        strokeWidth={1.5}
        aria-hidden="true"
      />
    );
  };

  if (interactive) {
    return (
      <div className="flex items-center gap-0.5" role="group" aria-label="Rating">
        {Array.from({ length: max }).map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onChange?.(i + 1)}
            aria-label={`Rate ${i + 1} out of ${max}`}
            aria-pressed={i < Math.round(rating)}
            className="p-0.5 rounded transition-transform hover:scale-110 focus-visible:outline-2"
          >
            {star(i)}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-0.5"
      role="img"
      aria-label={`Rated ${rating.toFixed(1)} out of ${max}`}
    >
      {Array.from({ length: max }).map((_, i) => (
        <span key={i}>{star(i)}</span>
      ))}
    </div>
  );
}
