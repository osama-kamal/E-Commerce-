import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppDispatch, useAppSelector } from '../hooks/useAppDispatch';
import { logout } from '../store/authSlice';
import { authApi } from '../api/auth';
import { useDarkMode } from '../hooks/useDarkMode';
import NotificationDropdown from './NotificationDropdown';

// Reusable spring config for all tap animations
const TAP_SPRING = { type: 'spring', stiffness: 400, damping: 10 } as const;

// motion-enhanced Link for tap animations on anchor elements
const MotionLink = motion(Link);

export default function Navbar() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAppSelector((s) => s.auth);
  const currentStore = useAppSelector((s) => s.currentStore.current);
  const cartCount = useAppSelector((s) =>
    s.cart.cart?.items.reduce((sum, i) => sum + i.quantity, 0) ?? 0
  );
  const cartLastUpdated = useAppSelector((s) => s.cart.lastUpdated);
  const { dark, toggle } = useDarkMode();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLogout = async () => {
    setMenuOpen(false);
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) {
      try { await authApi.logout(refreshToken); } catch { /* ignore */ }
    }
    dispatch(logout());
    navigate('/');
  };

  const initials = user?.email.slice(0, 2).toUpperCase() ?? '?';

  // Dynamic store branding
  const storeName = currentStore?.name ?? 'ShopHub';
  const storeLogo = currentStore?.settings?.logoUrl;

  return (
    <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Store branding */}
          <Link to="/" className="flex items-center gap-2.5 text-xl font-bold text-primary-600">
            {storeLogo && storeLogo.startsWith('http') ? (
              <img
                src={storeLogo}
                alt={storeName}
                className="w-8 h-8 rounded-lg object-contain"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : null}
            <span>{storeName}</span>
          </Link>

          <div className="flex items-center gap-4">
            <Link to="/" className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white">Home</Link>

            {isAuthenticated ? (
              <>
                {/* Cart with tap bounce */}
                <MotionLink
                  to="/cart"
                  whileTap={{ y: -5 }}
                  transition={TAP_SPRING}
                  className="relative text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                >
                  <motion.span
                    key={cartLastUpdated}
                    animate={cartLastUpdated > 0 ? { y: [0, -6, 0] } : {}}
                    transition={{ duration: 0.35, ease: 'easeOut' }}
                    className="inline-block"
                  >
                    Cart
                  </motion.span>
                  <AnimatePresence>
                    {cartCount > 0 && (
                      <motion.span
                        key={cartCount}
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        exit={{ scale: 0 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                        className="absolute -top-2 -right-3 bg-primary-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center"
                      >
                        {cartCount}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </MotionLink>

                {/* Wishlist with tap bounce */}
                <MotionLink
                  to="/wishlist"
                  whileTap={{ y: -5 }}
                  transition={TAP_SPRING}
                  className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                >
                  Wishlist
                </MotionLink>

                {/* Notifications */}
                {isAuthenticated && <NotificationDropdown />}

                {user?.role === 'admin' && (
                  <Link to="/admin" className="text-sm font-medium text-primary-600">Admin</Link>
                )}

                {/* User avatar dropdown */}
                <div className="relative" ref={menuRef}>
                  <motion.button
                    whileTap={{ y: -5 }}
                    transition={TAP_SPRING}
                    onClick={() => setMenuOpen(o => !o)}
                    className="w-8 h-8 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center hover:bg-primary-700 transition-colors"
                    aria-label="User menu"
                  >
                    {initials}
                  </motion.button>

                  <AnimatePresence>
                    {menuOpen && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 mt-2 w-48 card shadow-xl py-1 z-50"
                      >
                        <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800">
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{user?.email}</p>
                        </div>
                        <Link
                          to="/profile"
                          onClick={() => setMenuOpen(false)}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                          👤 Profile
                        </Link>
                        <Link
                          to="/orders"
                          onClick={() => setMenuOpen(false)}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                          📦 My Orders
                        </Link>
                        <Link
                          to="/wishlist"
                          onClick={() => setMenuOpen(false)}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                          ♡ Wishlist
                        </Link>
                        <div className="border-t border-gray-100 dark:border-gray-800 mt-1">
                          <button
                            onClick={handleLogout}
                            className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                          >
                            ↩ Logout
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </>
            ) : (
              <>
                <Link to="/login" className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white">Login</Link>
                <Link to="/register" className="btn-primary text-sm">Register</Link>
              </>
            )}

            {/* Dark mode toggle — animated switch */}
            <button
              onClick={toggle}
              aria-label="Toggle dark mode"
              className={`relative w-14 h-7 rounded-full transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                dark ? 'bg-indigo-600' : 'bg-gray-200'
              }`}
            >
              {/* Track icons */}
              <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-xs pointer-events-none select-none">
                🌙
              </span>
              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs pointer-events-none select-none">
                ☀️
              </span>
              {/* Thumb */}
              <span
                className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-md transform transition-transform duration-300 flex items-center justify-center text-sm ${
                  dark ? 'translate-x-7' : 'translate-x-0.5'
                }`}
              >
                {dark ? '🌙' : '☀️'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
