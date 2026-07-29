import { useCallback, useRef } from 'react';

interface Props {
  min: number;
  max: number;
  value: [number, number];
  onChange: (range: [number, number]) => void;
  step?: number;
}

/**
 * Zero-dependency dual-range slider built with two overlapping <input type="range">
 * elements and a Tailwind-styled track. No external packages required.
 *
 * Accessibility: each thumb is a native <input type="range"> so keyboard navigation
 * (arrow keys, Home, End) works out of the box.
 */
export default function PriceRangeSlider({
  min,
  max,
  value: [low, high],
  onChange,
  step = 1,
}: Props) {
  const rangeRef = useRef<HTMLDivElement>(null);

  // Percentage helpers for positioning the filled track
  const pct = useCallback(
    (v: number) => Math.round(((v - min) / (max - min)) * 100),
    [min, max],
  );

  const lowPct = pct(low);
  const highPct = pct(high);

  const handleLow = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = Math.min(Number(e.target.value), high - step);
    onChange([next, high]);
  };

  const handleHigh = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = Math.max(Number(e.target.value), low + step);
    onChange([low, next]);
  };

  return (
    <div className="w-full select-none">
      {/* Current range display */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 rounded-full">
          ${low.toLocaleString()}
        </span>
        <span className="text-xs text-gray-400">—</span>
        <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 rounded-full">
          ${high.toLocaleString()}
        </span>
      </div>

      {/* Slider track */}
      <div ref={rangeRef} className="relative h-2 w-full">
        {/* Grey background track */}
        <div className="absolute inset-0 rounded-full bg-gray-200 dark:bg-gray-600" />

        {/* Amber filled track between the two thumbs */}
        <div
          className="absolute h-full rounded-full bg-gradient-to-r from-amber-500 to-yellow-500"
          style={{ left: `${lowPct}%`, right: `${100 - highPct}%` }}
        />

        {/* Low thumb */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={low}
          onChange={handleLow}
          aria-label="Minimum price"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={low}
          className="
            absolute inset-0 w-full h-full
            appearance-none bg-transparent cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-white
            [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-amber-500
            [&::-webkit-slider-thumb]:shadow-md
            [&::-webkit-slider-thumb]:transition-transform
            [&::-webkit-slider-thumb]:hover:scale-125
            [&::-webkit-slider-thumb]:focus:scale-125
            [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4
            [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-white
            [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-amber-500
            [&::-moz-range-thumb]:shadow-md
            [&::-moz-range-thumb]:border-none
            [&::-webkit-slider-runnable-track]:bg-transparent
            [&::-moz-range-track]:bg-transparent
            focus:outline-none
          "
          style={{ pointerEvents: low === high ? 'none' : 'auto', zIndex: low > max - step ? 5 : 3 }}
        />

        {/* High thumb */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={high}
          onChange={handleHigh}
          aria-label="Maximum price"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={high}
          className="
            absolute inset-0 w-full h-full
            appearance-none bg-transparent cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-white
            [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-amber-500
            [&::-webkit-slider-thumb]:shadow-md
            [&::-webkit-slider-thumb]:transition-transform
            [&::-webkit-slider-thumb]:hover:scale-125
            [&::-webkit-slider-thumb]:focus:scale-125
            [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4
            [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-white
            [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-amber-500
            [&::-moz-range-thumb]:shadow-md
            [&::-moz-range-thumb]:border-none
            [&::-webkit-slider-runnable-track]:bg-transparent
            [&::-moz-range-track]:bg-transparent
            focus:outline-none
          "
          style={{ zIndex: 4 }}
        />
      </div>

      {/* Min/Max labels */}
      <div className="flex justify-between mt-2">
        <span className="text-[10px] text-gray-400">${min}</span>
        <span className="text-[10px] text-gray-400">${max}</span>
      </div>
    </div>
  );
}
