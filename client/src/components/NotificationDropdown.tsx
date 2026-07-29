import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, Bell, BellOff, CheckCircle2, Info, type LucideIcon, XCircle,
} from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../hooks/useAppDispatch';
import { markAsRead, markAllAsRead, removeNotification } from '../store/notificationSlice';

/**
 * Per-type notification glyph.
 *
 * Replaces an emoji map (✅ ℹ️ ⚠️ ❌ 🔔). Those glyphs were full-colour and
 * fixed-hue, so the "success" tick stayed the same saturated green on a dark
 * surface where it clashed; a stroke icon takes its tone from a class instead.
 */
const TYPE_ICON: Record<string, { Icon: LucideIcon; tone: string }> = {
  success: { Icon: CheckCircle2,  tone: 'text-emerald-500' },
  info:    { Icon: Info,          tone: 'text-blue-500' },
  warning: { Icon: AlertTriangle, tone: 'text-amber-500' },
  error:   { Icon: XCircle,       tone: 'text-red-500' },
};

function NotificationTypeIcon({ type }: { type: string }) {
  const { Icon, tone } = TYPE_ICON[type] ?? { Icon: Bell, tone: 'text-gray-400' };
  return <Icon className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${tone}`} aria-hidden="true" />;
}

export default function NotificationDropdown() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { notifications, unreadCount } = useAppSelector((s) => s.notifications);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNotificationClick = (notificationId: string, actionUrl?: string) => {
    dispatch(markAsRead(notificationId));
    if (actionUrl) {
      navigate(actionUrl);
      setIsOpen(false);
    }
  };


  const formatTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Icon */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={isOpen}
      >
        <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-gray-900">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute right-0 mt-2 w-96 bg-white dark:bg-gray-800 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden z-50"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-white">
                Notifications {unreadCount > 0 && `(${unreadCount})`}
              </h3>
              {notifications.length > 0 && (
                <button
                  onClick={() => dispatch(markAllAsRead())}
                  className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                >
                  Mark all as read
                </button>
              )}
            </div>

            {/* Notifications List */}
            <div className="max-h-96 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800">
                    <BellOff className="h-5 w-5 text-gray-400" strokeWidth={1.5} aria-hidden="true" />
                  </div>
                  <p className="text-[13px] font-semibold text-gray-900 dark:text-white">No notifications yet</p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Order updates and offers will show up here.
                  </p>
                </div>
              ) : (
                notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className={`p-4 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                      !notification.read ? 'bg-blue-50 dark:bg-blue-900/10' : ''
                    }`}
                  >
                    <div className="flex gap-3">
                      <NotificationTypeIcon type={notification.type} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-medium text-gray-900 dark:text-white text-sm">
                            {notification.title}
                          </h4>
                          <button
                            onClick={() => dispatch(removeNotification(notification.id))}
                            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none"
                            aria-label="Remove"
                          >
                            ×
                          </button>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                          {notification.message}
                        </p>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-xs text-gray-500">
                            {formatTime(notification.timestamp)}
                          </span>
                          {notification.actionUrl && (
                            <button
                              onClick={() => handleNotificationClick(notification.id, notification.actionUrl)}
                              className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                            >
                              View →
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
