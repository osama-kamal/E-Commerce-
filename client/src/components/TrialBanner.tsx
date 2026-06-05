import { useNavigate } from 'react-router-dom';
import { useTrialStatus } from '../hooks/useTrialStatus';

/**
 * Sticky banner shown at the top of the admin main area during the trial period.
 * Hidden once the store is on a paid plan.
 */
export default function TrialBanner() {
  const navigate = useNavigate();
  const { daysRemaining, isTrialing, isPaid } = useTrialStatus();

  // Don't show for paid plans or after expiry (paywall takes over)
  if (isPaid || !isTrialing) return null;

  const isUrgent = daysRemaining <= 2;
  const isWarning = daysRemaining <= 4 && !isUrgent;

  const bgClass = isUrgent
    ? 'bg-red-600 text-white'
    : isWarning
    ? 'bg-amber-500 text-white'
    : 'bg-indigo-600 text-white';

  const label = daysRemaining === 0
    ? 'Your free trial expires today!'
    : daysRemaining === 1
    ? '1 day of free trial remaining'
    : `${daysRemaining} days of free trial remaining`;

  return (
    <div className={`${bgClass} px-4 py-2.5 flex items-center justify-between gap-4 text-sm`}>
      <div className="flex items-center gap-2">
        <span>{isUrgent ? '🚨' : isWarning ? '⚠️' : '🎉'}</span>
        <span className="font-medium">{label}</span>
        {!isUrgent && !isWarning && (
          <span className="opacity-80">— Full access to all features</span>
        )}
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
