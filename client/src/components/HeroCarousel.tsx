import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

const slides = [
  { id: 1, title: '🛍️ Shop Now',        subtitle: 'Discover Our Amazing Collection',    image: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1200&q=80', cta: 'Shop Now',  alt: 'A bright, well-stocked retail store interior' },
  { id: 2, title: '🔥 Hot Deals',        subtitle: 'Up to 50% Off on Selected Items',     image: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=1200&q=80', cta: 'See Deals', alt: 'Colorful shopping bags and sale tags' },
  { id: 3, title: '👗 Fashion Week',     subtitle: 'Trending Styles for Every Occasion',  image: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1200&q=80', cta: 'Explore',   alt: 'Fashion clothing displayed on hangers' },
  { id: 4, title: '💻 Tech Essentials',  subtitle: 'Latest Gadgets and Electronics',      image: 'https://images.unsplash.com/photo-1498049794561-7780e7231661?w=1200&q=80', cta: 'Shop Tech', alt: 'Laptop and modern tech gadgets on a desk' },
  { id: 5, title: '🎁 Special Offers',   subtitle: 'Exclusive Deals Just for You',        image: 'https://images.unsplash.com/photo-1607082349566-187342175e2f?w=1200&q=80', cta: 'Claim Now', alt: 'Gift boxes wrapped with colorful ribbons' },
];

export default function HeroCarousel() {
  const [, setSearchParams] = useSearchParams();
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);

  const next = useCallback(() => setCurrent(c => (c + 1) % slides.length), []);
  const prev = () => setCurrent(c => (c - 1 + slides.length) % slides.length);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(next, 4000);
    return () => clearInterval(t);
  }, [paused, next]);

  const handleCTA = () => {
    setSearchParams({}, { replace: true });
    setTimeout(() => {
      document.querySelector('[data-products-section]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  return (
    <div
      className="relative w-full rounded-2xl overflow-hidden mb-8"
      style={{ aspectRatio: '16/6' }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-label="Hero carousel"
    >
      {/* Slide track */}
      <div
        className="flex h-full transition-transform duration-[600ms] ease-in-out"
        style={{ width: `${slides.length * 100}%`, transform: `translateX(-${(current * 100) / slides.length}%)` }}
      >
        {slides.map((sl, i) => (
          <div
            key={sl.id}
            className="relative h-full flex-shrink-0"
            style={{ width: `${100 / slides.length}%` }}
          >
            {/* fetchpriority (lowercase) is the correct HTML attribute name.
                React 18 types only expose camelCase fetchPriority which warns
                at runtime, so we spread it as an untyped extra prop instead. */}
            <img
              src={sl.image}
              alt={sl.alt}
              className="absolute inset-0 w-full h-full object-cover"
              loading={i === 0 ? 'eager' : 'lazy'}
              decoding="async"
              width="1200"
              height="450"
              {...({ fetchpriority: i === 0 ? 'high' : 'auto' } as object)}
            />
            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/30 to-transparent" />
            {/* Content */}
            <div className="relative h-full flex items-center px-10 sm:px-16">
              <div className="max-w-lg">
                <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">{sl.title}</h2>
                <p className="text-lg text-gray-200 mb-6">{sl.subtitle}</p>
                <button
                  onClick={handleCTA}
                  className="bg-white text-gray-900 font-semibold px-8 py-3 rounded-lg hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black/50"
                >
                  {sl.cta} →
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Prev / Next */}
      <button
        onClick={prev}
        aria-label="Previous slide"
        className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 text-white text-2xl flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-white"
      >
        ‹
      </button>
      <button
        onClick={next}
        aria-label="Next slide"
        className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 text-white text-2xl flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-white"
      >
        ›
      </button>

      {/* Dot indicators */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex gap-2" role="tablist" aria-label="Slide indicators">
        {slides.map((_, i) => (
          <button
            key={i}
            role="tab"
            aria-selected={i === current}
            aria-label={`Go to slide ${i + 1}`}
            onClick={() => setCurrent(i)}
            className={`h-2.5 rounded-full border-none cursor-pointer transition-all duration-300 ${
              i === current ? 'w-6 bg-white' : 'w-2.5 bg-white/50'
            }`}
          />
        ))}
      </div>

      {/* Counter */}
      <div className="absolute top-3 right-3 z-10 bg-black/40 text-white text-xs px-3 py-1 rounded-full" aria-live="polite">
        {current + 1} / {slides.length}
      </div>
    </div>
  );
}
