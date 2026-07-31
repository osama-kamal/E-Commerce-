import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Heart, Loader2, Package, Eye, ShoppingCart } from 'lucide-react';
import { Product } from '../types';
import StarRating from './StarRating';
import QuickViewModal from './QuickViewModal';
import { wishlistApi } from '../api/wishlist';
import { addToWishlist, removeFromWishlist } from '../store/wishlistSlice';
import { addToComparison, removeFromComparison } from '../store/comparisonSlice';
import { addNotification } from '../store/notificationSlice';
import { useAppDispatch, useAppSelector } from '../hooks/useAppDispatch';
import { useAddToCart } from '../hooks/useCart';
import toast from 'react-hot-toast';

interface Props {
  product: Product;
  index?: number;
  detailPath?: string;   // override the default /products/:id link (e.g. for storefront routes)
  loginRedirect?: string; // override the /login redirect (e.g. /s/slug for storefront)
  /**
   * Presentation only — no behavioural difference.
   *
   * `card`      (default) the boxed surface used everywhere today.
   * `editorial` shell-less tile for the luxury homepage: portrait crop, hairline
   *             instead of border+shadow, text badges instead of filled pills,
   *             and secondary controls revealed on hover/focus (see `.tile-actions`
   *             in index.css — they stay in the DOM and in the tab order).
   *
   * Opt-in so wishlist, search, compare and the storefront pages are untouched.
   */
  variant?: 'card' | 'editorial';
}

export default function ProductCard({ product, index = 0, detailPath, loginRedirect, variant = 'card' }: Props) {
  const editorial = variant === 'editorial';
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const isAuthenticated = useAppSelector((s) => s.auth.isAuthenticated);
  const isInWishlist = useAppSelector((s) =>
    s.wishlist.items.some(i => i._id === product._id)
  );
  const isInComparison = useAppSelector((s) =>
    s.comparison.products.some(p => p._id === product._id)
  );
  const comparisonCount = useAppSelector((s) => s.comparison.products.length);

  const [imgLoaded, setImgLoaded] = useState(false);
  const [wishlistLoading, setWishlistLoading] = useState(false);
  const [showQuickView, setShowQuickView] = useState(false);
  const [qty, setQty] = useState(1);
  const [isAdding, setIsAdding] = useState(false);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);

  // ── React Query optimistic cart mutation ───────────────────────────────────
  const addToCart = useAddToCart();

  const image = product.images?.[0] ?? null;
  const isOutOfStock = product.stock === 0;
  const isLowStock = product.stock > 0 && product.stock <= 3;
  const hasDiscount = product.discount > 0;
  const discountedPrice = hasDiscount ? product.price * (1 - product.discount / 100) : product.price;
  const hasSizes = Array.isArray(product.sizes) && product.sizes.length > 0;
  const needsSize = hasSizes && !selectedSize; // true when size required but not chosen

  const handleAddToCart = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!isAuthenticated) {
      navigate(loginRedirect ? `/login?redirect=${encodeURIComponent(loginRedirect)}` : '/login');
      return;
    }
    if (needsSize) return; // guard: size required but not selected
    if (isAdding) return; // synchronous guard — blocks any click that arrives before re-render
    setIsAdding(true);
    try {
      const addedQty = qty; // capture before reset
      await addToCart.mutateAsync({
        productId: product._id,
        quantity: addedQty,
        productName: product.name,
        selectedSize: selectedSize ?? undefined,
      });
      setQty(1);
      dispatch(addNotification({
        type: 'success',
        title: 'Added to Cart',
        message: `${addedQty > 1 ? `${addedQty}× ` : ''}${product.name}${selectedSize ? ` (${selectedSize})` : ''} added to your cart`,
        actionUrl: '/cart',
      }));
    } catch {
      // error toast is already shown by the axios interceptor
    } finally {
      setIsAdding(false);
    }
  };

  const handleToggleWishlist = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!isAuthenticated) {
      navigate(loginRedirect ? `/login?redirect=${encodeURIComponent(loginRedirect)}` : '/login');
      return;
    }
    setWishlistLoading(true);
    try {
      if (isInWishlist) {
        await wishlistApi.remove(product._id);
        dispatch(removeFromWishlist(product._id));
        toast('Removed from wishlist');
      } else {
        await wishlistApi.add(product._id);
        dispatch(addToWishlist({
          _id: product._id,
          name: product.name,
          price: product.price,
          images: product.images,
          stock: product.stock,
          averageRating: product.averageRating,
        }));
        toast.success('Added to wishlist!');
        dispatch(addNotification({
          type: 'info',
          title: 'Added to Wishlist',
          message: `${product.name} has been added to your wishlist`,
          actionUrl: '/wishlist',
        }));
      }
    } finally {
      setWishlistLoading(false);
    }
  };

  const handleToggleComparison = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isInComparison) {
      dispatch(removeFromComparison(product._id));
      toast('Removed from comparison');
    } else {
      if (comparisonCount >= 4) {
        toast.error('Maximum 4 products can be compared');
        e.target.checked = false;
        return;
      }
      dispatch(addToComparison(product));
      toast.success('Added to comparison!');
    }
  };

  return (
    <>
      {/* Elevation replaces the old `hover:scale-[1.02]`: scaling a grid item
          resamples its text on every frame (visibly soft) and lets the card
          overlap its neighbours. A translate + shadow change reads as depth
          without touching the layout. The amber tint is gone — a warm wash over
          a warm price colour was muddying both. */}
      <div
        className={
          editorial
            ? 'tile group flex cursor-pointer flex-col'
            : 'surface surface-interactive group flex flex-col overflow-hidden cursor-pointer'
        }
      >
      <Link to={detailPath ?? `/products/${product._id}`} className="flex flex-col flex-1">
        {/* Portrait 3:4 in editorial mode. A square crop is the e-commerce
            default; fashion and lifestyle photography is shot portrait, and the
            taller frame is most of why a luxury grid looks considered. */}
        <div className={`relative overflow-hidden bg-ivory-100 dark:bg-stone-900 ${editorial ? 'aspect-[3/4]' : 'aspect-square bg-gray-100 dark:bg-gray-800'}`}>
          {!imgLoaded && <div className="absolute inset-0 shimmer" />}
          {image ? (
            <img
              src={image}
              alt={product.name}
              loading="lazy"
              decoding="async"
              width="400"
              height="400"
              onLoad={() => setImgLoaded(true)}
              // Slow zoom on hover — the single cue that most separates a premium
              // product grid from a plain one. 700ms is deliberately unhurried.
              className={`w-full h-full object-cover transition-all duration-700 ease-out group-hover:scale-[1.07] ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-300 dark:text-gray-600">
              <Package className="w-12 h-12" strokeWidth={1.25} aria-hidden="true" />
            </div>
          )}

          {/* Bottom scrim so white badges and controls stay legible over pale product photography. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/25 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" aria-hidden="true" />

          {/* Stock badges — three hand-rolled pill styles collapsed onto the
              shared .badge scale so weight, radius and tracking match. */}
          {/* Editorial badges are set type on the image, not filled pills. A red
              "−30% OFF" lozenge is a discount-retail signal and reads as cheap
              on a luxury grid; the same information as tracked small caps does
              not. Identical conditions and content in both modes. */}
          {isOutOfStock && (
            <span className={editorial
              ? 'smallcaps absolute left-4 top-4 bg-white/90 px-2.5 py-1 text-stone-900 backdrop-blur-sm'
              : 'badge badge-neutral absolute top-3 left-3'}>
              Out of Stock
            </span>
          )}
          {!isOutOfStock && hasDiscount && (
            <span className={editorial
              ? 'smallcaps absolute left-4 top-4 bg-stone-900/85 px-2.5 py-1 text-white backdrop-blur-sm'
              : 'badge badge-danger absolute top-3 left-3'}>
              {editorial ? `${product.discount}% off` : `−${product.discount}% OFF`}
            </span>
          )}
          {!isOutOfStock && !hasDiscount && isLowStock && (
            <span className={editorial
              ? 'smallcaps absolute left-4 top-4 bg-white/90 px-2.5 py-1 text-stone-900 backdrop-blur-sm'
              : 'badge badge-warning absolute top-3 left-3'}>
              Only {product.stock} left
            </span>
          )}

          {/* Heart button */}
          <button
            onClick={handleToggleWishlist}
            disabled={wishlistLoading}
            // 36px target (was 32) and a spring-ish pop on activation. The
            // `active:scale-90` gives the tap physical feedback that the old
            // instant colour swap lacked.
            className={`absolute top-3 right-3 w-9 h-9 rounded-full flex items-center justify-center text-base
                        shadow-elevated backdrop-blur-sm transition-all duration-200
                        hover:scale-110 active:scale-90 ${
              isInWishlist
                ? 'bg-red-500 text-white scale-105'
                : 'bg-white/85 dark:bg-gray-900/80 text-gray-500 hover:text-red-500'
            }`}
            aria-label={isInWishlist ? 'Remove from wishlist' : 'Add to wishlist'}
          >
            {/* One icon, filled or not — the old ♥/♡ glyph pair changed shape
                AND weight between states because they are different characters
                in the font. */}
            <Heart
              className={`h-[18px] w-[18px] transition-transform duration-200 ${isInWishlist ? 'animate-scale-in' : ''}`}
              fill={isInWishlist ? 'currentColor' : 'none'}
              strokeWidth={2}
              aria-hidden="true"
            />
          </button>

          {/* Quick View button */}
          <button
            onClick={(e) => {
              e.preventDefault();
              setShowQuickView(true);
            }}
            // Rises into place instead of just fading — and the emoji is now an
            // outline icon that inherits currentColor like every other glyph.
            className="absolute bottom-3 right-3 flex h-9 w-9 translate-y-2 items-center justify-center rounded-full
                       bg-white/90 text-gray-700 opacity-0 shadow-elevated backdrop-blur-sm transition-all duration-200
                       hover:scale-110 hover:bg-white group-hover:translate-y-0 group-hover:opacity-100
                       dark:bg-gray-900/85 dark:text-gray-200"
            aria-label="Quick view"
          >
            <Eye className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden="true" />
          </button>
        </div>

        <div className={editorial ? 'flex flex-1 flex-col pt-5' : 'p-5 flex flex-col flex-1'}>
          {/* Two lines with a reserved min-height instead of `truncate`: names
              were being cut mid-word, and a fixed block keeps every card in the
              row aligned regardless of name length. */}
          <h3 className="min-h-[2.6rem] text-[15px] font-semibold leading-[1.3] text-gray-900 dark:text-white line-clamp-2">
            {product.name}
          </h3>

          <div className="mt-2 flex items-center gap-1.5">
            <StarRating rating={product.averageRating} size="sm" />
            {/* gray-400 on white measures 2.54:1 — below the 4.5:1 AA minimum
                for text this size. gray-500 is 4.83:1 and visually near-identical. */}
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">({product.reviewCount})</span>
          </div>

          {/* Price. Moved off amber onto near-black: an amber price on the old
              amber-tinted card had almost no separation. The discounted state
              keeps the sale figure dark and de-emphasises the struck original,
              which is the ordering shoppers actually scan. */}
          <div className="mt-3.5">
            {hasDiscount ? (
              <div className="flex items-baseline gap-2">
                <span className="text-[22px] font-bold tracking-tight text-gray-900 dark:text-white">
                  ${discountedPrice.toFixed(2)}
                </span>
                <span className="text-sm font-medium text-gray-500 line-through dark:text-gray-400">
                  ${product.price.toFixed(2)}
                </span>
                {/* The savings chip is a discount-retail device — suppressed in
                    editorial mode, where the struck original already tells the
                    story without shouting. */}
                {!editorial && (
                  <span className="ml-auto text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    Save ${(product.price - discountedPrice).toFixed(2)}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-[22px] font-bold tracking-tight text-gray-900 dark:text-white">
                ${product.price.toFixed(2)}
              </span>
            )}
          </div>

          {/* Everything below is secondary. In editorial mode `.tile-actions`
              fades it in on hover or keyboard focus (and shows it unconditionally
              on touch devices) — see index.css. Nothing is removed from the DOM,
              so every control stays tabbable and functional in both modes. */}
          {/* `contents` in card mode so the wrapper generates no box at all and
              the existing layout (including the compare row's mt-auto) is
              byte-identical. In editorial mode it becomes a real flex column so
              mt-auto still pins compare to the bottom. */}
          <div className={editorial ? 'tile-actions flex flex-1 flex-col' : 'contents'}>

          {/* Size selector — only shown when product has variants.
              Chips are now 24px tall with real hit area (were 10px text in a
              0.5-padding box, below the 24px minimum for a touch target) and the
              selected state is near-black rather than amber, so it reads as
              "chosen" instead of "highlighted". */}
          {hasSizes && !isOutOfStock && (
            <div className="mt-3.5">
              {/* flex-nowrap + overflow-hidden keeps all buttons on one line regardless of count */}
              <div className="flex flex-nowrap gap-1.5 overflow-hidden">
                {product.sizes.map(size => (
                  <button
                    key={size}
                    onClick={(e) => { e.preventDefault(); setSelectedSize(s => s === size ? null : size); }}
                    aria-pressed={selectedSize === size}
                    className={`shrink-0 min-w-[30px] rounded-md px-2 py-1 text-[11px] font-semibold transition-all duration-200 ${
                      selectedSize === size
                        ? 'bg-gray-900 text-white shadow-soft dark:bg-white dark:text-gray-900'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
              {needsSize && (
                <p className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                  Select a size
                </p>
              )}
            </div>
          )}

          {/* Action footer — quantity stepper + Add to Cart, aligned consistently */}
          <div className="mt-3">
            {isOutOfStock ? (
              <div className="w-full rounded-xl bg-gray-100 py-2.5 text-center text-xs font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                Out of Stock
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {/* Quantity stepper — fixed width, doesn't grow.
                    Amber chrome removed: on a card whose price and CTA are also
                    warm, an amber-bordered stepper competed with the actual CTA
                    for attention. Neutral chrome lets the brand colour mean
                    "this is the action". */}
                <div className="flex items-center rounded-xl bg-gray-100 shrink-0 w-[92px] dark:bg-gray-800">
                  <button
                    onClick={(e) => { e.preventDefault(); setQty(q => Math.max(1, q - 1)); }}
                    disabled={qty <= 1}
                    aria-label="Decrease quantity"
                    className="px-2.5 py-2 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white rounded-l-xl disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={product.stock}
                    value={qty}
                    onClick={(e) => e.preventDefault()}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (!isNaN(v)) setQty(Math.min(product.stock, Math.max(1, v)));
                    }}
                    onBlur={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (isNaN(v) || v < 1) setQty(1);
                    }}
                    className="w-full min-w-0 flex-1 py-2 text-sm font-bold tabular-nums text-gray-900 dark:text-white text-center bg-transparent border-none outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    aria-label="Quantity"
                  />
                  <button
                    onClick={(e) => { e.preventDefault(); setQty(q => Math.min(product.stock, q + 1)); }}
                    disabled={qty >= product.stock}
                    aria-label="Increase quantity"
                    className="px-2.5 py-2 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white rounded-r-xl disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    +
                  </button>
                </div>

                {/* Add to Cart button — grows to fill remaining space */}
                <button
                  onClick={handleAddToCart}
                  disabled={!isAuthenticated || isAdding || needsSize}
                  aria-disabled={needsSize}
                  title={isAdding ? 'Adding…' : needsSize ? 'Select a size first' : 'Add to Cart'}
                  // gap-1.5/py-1.5/px-2 kept: this button sits in a tight card
                  // footer and .btn's default padding would grow the card.
                  // rounded-xl matches the stepper beside it; the two controls
                  // previously used different radii (lg vs lg-on-a-taller-box)
                  // and read as parts from two different kits.
                  className={`btn flex-1 gap-1.5 rounded-xl px-2 py-2 text-white disabled:cursor-not-allowed ${
                    needsSize
                      ? 'bg-gray-300 text-gray-600 shadow-none dark:bg-gray-700 dark:text-gray-400'
                      : 'btn-brand'
                  }`}
                >
                  {isAdding ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
                      <span className="text-xs font-semibold">Adding…</span>
                    </>
                  ) : needsSize ? (
                    <>
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="text-xs font-semibold">Pick a size</span>
                    </>
                  ) : (
                    <>
                      <ShoppingCart className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="text-xs font-semibold">Add to Cart</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Compare checkbox — always pinned at the very bottom of every card */}
          {/* Hairline divider instead of the amber rule — a tinted border at
              the foot of every card in a 4-up grid created a visible warm stripe
              across the whole page. */}
          <div className="mt-auto pt-3.5 border-t border-gray-100 dark:border-gray-800">
            {/* py-1 lifts the row past the 24px WCAG 2.5.8 (AA) target size —
                measured at 320px the bare 16px checkbox was the only control on
                the card that failed it. The label wraps the input, so the whole
                row is the hit area. */}
            <label className="group flex w-fit cursor-pointer items-center gap-2 py-1">
              <input
                type="checkbox"
                checked={isInComparison}
                onChange={handleToggleComparison}
                className="h-[18px] w-[18px] shrink-0 rounded border-gray-300 text-gray-900 focus:ring-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
              <span className="text-xs font-medium text-gray-500 transition-colors group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-white">
                Compare
              </span>
            </label>
          </div>
          </div>
        </div>
      </Link>
    </div>
      <QuickViewModal
        product={product}
        isOpen={showQuickView}
        onClose={() => setShowQuickView(false)}
      />
    </>
  );
}
