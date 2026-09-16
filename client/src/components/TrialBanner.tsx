import { useNavigate } from 'react-router-dom';
import { useTrialStatus } from '../hooks/useTrialStatus';

/**
 * Sticky banner at the top of the admin main area.
 *
 * Two distinct states, because trial end is a DOWNGRADE, not a lockout:
 *
 *   • during the trial  — countdown, escalating in urgency
 *   • after the trial   — a persistent, calm upsell explaining that the store
 *                         is now on the free tier and what that costs them
 *
 * The second state is new. Trial end used to hard-wall the entire dashboard
 * (TrialExpiredWall), which is why this banner returned null the moment the
 * trial lapsed — there was nothing left to annotate. Free is sold as a
 * permanent $0 tier, so the store keeps working and this becomes the upsell
 * surface instead.
 *
 * Hidden entirely for paid plans and for restricted stores (the wall covers
 * those).
 */
export default function TrialBanner() {
  const navigate = useNavigate();
  const { daysRemaining, isTrialing, isPaid, isTrialOver, isRestricted } = useTrialStatus();

  if (isPaid || isRestricted) return null;

  // ── Post-trial: on the free tier ───────────────────────────────────────────
  if (isTrialOver) {
    return (
      <div className="bg-gray-800 text-white px-4 py-2.5 flex items-center justify-between gap-4 text-sm dark:bg-gray-800">
        <div className="flex items-center gap-2">
          <span aria-hidden="true">✨</span>
          <span className="font-medium">You&rsquo;re on the Free plan</span>
          <span className="opacity-80 hidden sm:inline">
            &mdash; 15 products and 50 orders/month. Upgrade to lift the limits.
          </span>
        </div>
        <button
          onClick={() => navigate('/admin/pricing')}
          className="shrink-0 bg-white/20 hover:bg-white/30 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors border border-white/30"
        >
          See plans →
        </button>
      </div>
    );
  }

  if (!isTrialing) return null;

  // ── During the trial: countdown ────────────────────────────────────────────
  const isUrgent = daysRemaining <= 2;
  const isWarning = daysRemaining <= 4 && !isUrgent;

  const bgClass = isUrgent
    ? 'bg-red-600 text-white'
    : isWarning
    ? 'bg-amber-500 text-white'
    : 'bg-indigo-600 text-white';

  const label = daysRemaining === 0
    ? 'Your free trial ends today'
    : daysRemaining === 1
    ? '1 day of free trial remaining'
    : `${daysRemaining} days of free trial remaining`;

  return (
    <div className={`${bgClass} px-4 py-2.5 flex items-center justify-between gap-4 text-sm`}>
      <div className="flex items-center gap-2">
        <span aria-hidden="true">{isUrgent ? '🚨' : isWarning ? '⚠️' : '🎉'}</span>
        <span className="font-medium">{label}</span>
        {/* Reassure rather than threaten: nothing is lost at the end of the
            trial, the store simply moves to the free tier. Promising otherwise
            would now be a lie. */}
        <span className="opacity-80 hidden sm:inline">
          {/* Plain string literals, so a real apostrophe — an HTML entity here
              would render as the literal characters "&rsquo;". */}
          {isUrgent || isWarning
            ? '— you’ll move to the Free plan after this'
            : '— full access to all features'}
        </span>
      </div>
      <button
        onClick={() => navigate('/admin/pricing')}
        className="shrink-0 bg-white/20 hover:bg-white/30 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors border border-white/30"
      >
        Upgrade Now →
      </button>
    </div>
  );
}
