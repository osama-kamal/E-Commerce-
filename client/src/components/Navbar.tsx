import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppDispatch, useAppSelector } from '../hooks/useAppDispatch';
import { logoutThunk } from '../store/authSlice';
import { useDarkMode } from '../hooks/useDarkMode';
import NotificationDropdown from './NotificationDropdown';

// Reusable spring config for tap animations
const TAP_SPRING = { type: 'spring', stiffness: 400, damping: 10 } as const;

// motion-enhanced Link for tap animations
const MotionLink = motion(Link);

export default function Navbar() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated } = useAppSelector((s) => s.auth);
  const currentStore = useAppSelector((s) => s.currentStore.current);
  const cartCount = useAppSelector((s) =>
    s.cart.cart?.items.reduce((sum, i) => sum + i.quantity, 0) ?? 0
  );
  const cartLastUpdated = useAppSelector((s) => s.cart.lastUpdated);
  const { dark, toggle } = useDarkMode();

  // Desktop user-avatar dropdown
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Mobile drawer
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close desktop dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Close mobile drawer on route change
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // Close drawer on Escape key
  useEffect(() => {
    if (!drawerOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [drawerOpen]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [drawerOpen]);

  const handleLogout = async () => {
    setMenuOpen(false);
    setDrawerOpen(false);
    // logoutThunk revokes the session server-side and clears local state.
    await dispatch(logoutThunk());
    navigate('/');
  };

  const initials = user?.email.slice(0, 2).toUpperCase() ?? '?';
  const storeName = currentStore?.name ?? 'Vendbase';
  const storeLogo = currentStore?.settings?.logoUrl;

  // ── Shared dark-mode toggle ───────────────────────────────────────────────
  const DarkModeToggle = ({ className = '' }: { className?: string }) => (
    <button
      onClick={toggle}
      aria-label="Toggle dark mode"
      className={`relative w-14 h-7 rounded-full transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
        dark ? 'bg-indigo-600' : 'bg-gray-200'
      } ${className}`}
    >
      <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-xs pointer-events-none select-none">🌙</span>
      <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs pointer-events-none select-none">☀️</span>
      <span
        className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-md transform transition-transform duration-300 flex items-center justify-center text-sm ${
          dark ? 'translate-x-7' : 'translate-x-0.5'
        }`}
      >
        {dark ? '🌙' : '☀️'}
      </span>
    </button>
  );

  return (
    <>
      <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">

            {/* ── Store branding ── */}
            <Link to="/" className="flex items-center gap-2.5 text-xl font-bold text-primary-600 shrink-0">
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

            {/* ── Desktop nav (hidden on mobile) ── */}
            <div className="hidden md:flex items-center gap-4">
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

                  <MotionLink
                    to="/wishlist"
                    whileTap={{ y: -5 }}
                    transition={TAP_SPRING}
                    className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                  >
                    Wishlist
                  </MotionLink>

                  <NotificationDropdown />

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
                      aria-expanded={menuOpen}
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
                          <Link to="/profile" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
                            👤 Profile
                          </Link>
                          <Link to="/orders" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
                            📦 My Orders
                          </Link>
                          <Link to="/wishlist" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
                            ♡ Wishlist
                          </Link>
                          <div className="border-t border-gray-100 dark:border-gray-800 mt-1">
                            <button onClick={handleLogout} className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
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
                  <Link to="/start" className="text-sm font-semibold px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white transition-colors">
                    Start Free Trial
                  </Link>
                </>
              )}

              <DarkModeToggle />
            </div>

            {/* ── Mobile right side: cart icon + hamburger ── */}
            <div className="flex md:hidden items-center gap-3">
              {/* Cart icon — always visible on mobile so users can tap it quickly */}
              {isAuthenticated && (
                <Link to="/cart" className="relative p-2 text-gray-600 dark:text-gray-300" aria-label={`Cart, ${cartCount} items`}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13l-1.5 6h13M10 19a1 1 0 100 2 1 1 0 000-2zm7 0a1 1 0 100 2 1 1 0 000-2z" />
                  </svg>
                  {cartCount > 0 && (
                    <span className="absolute top-0.5 right-0.5 bg-primary-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">
                      {cartCount}
                    </span>
                  )}
                </Link>
              )}

              {/* Hamburger button — 44×44 touch target */}
              <button
                onClick={() => setDrawerOpen(true)}
                aria-label="Open menu"
                aria-expanded={drawerOpen}
                className="p-2 w-11 h-11 flex flex-col items-center justify-center gap-1.5 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <span className="w-5 h-0.5 bg-current rounded-full" />
                <span className="w-5 h-0.5 bg-current rounded-full" />
                <span className="w-5 h-0.5 bg-current rounded-full" />
              </button>
            </div>

          </div>
        </div>
      </nav>

      {/* ── Mobile drawer ─────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[60] bg-black/50 md:hidden"
              onClick={() => setDrawerOpen(false)}
              aria-hidden="true"
            />

            {/* Drawer panel */}
            <motion.div
              key="drawer"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 350, damping: 35 }}
              className="fixed top-0 right-0 h-full w-72 z-[70] bg-white dark:bg-gray-900 shadow-2xl md:hidden flex flex-col"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation menu"
            >
              {/* Drawer header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                <span className="font-bold text-lg text-primary-600">{storeName}</span>
                <button
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close menu"
                  className="p-2 w-10 h-10 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Drawer content — scrollable */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1">

                {isAuthenticated ? (
                  <>
                    {/* User info */}
                    <div className="flex items-center gap-3 py-3 mb-2">
                      <div className="w-10 h-10 rounded-full bg-primary-600 text-white text-sm font-bold flex items-center justify-center shrink-0">
                        {initials}
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 truncate">{user?.email}</p>
                    </div>

                    {/* Nav links — each row is min 44px tall */}
                    <DrawerLink to="/" icon="🏠" label="Home" />
                    <DrawerLink to="/cart" icon="🛒" label="Cart" badge={cartCount > 0 ? cartCount : undefined} />
                    <DrawerLink to="/wishlist" icon="♡" label="Wishlist" />
                    <DrawerLink to="/orders" icon="📦" label="My Orders" />
                    <DrawerLink to="/profile" icon="👤" label="Profile" />

                    {user?.role === 'admin' && (
                      <DrawerLink to="/admin" icon="⚙️" label="Admin Dashboard" />
                    )}

                    {/* Notifications row */}
                    <div className="flex items-center gap-3 py-3 border-t border-gray-100 dark:border-gray-800 mt-2">
                      <span className="text-lg">🔔</span>
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Notifications</span>
                      <div className="ml-auto">
                        <NotificationDropdown />
                      </div>
                    </div>

                    <div className="border-t border-gray-100 dark:border-gray-800 pt-2">
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 py-3 px-2 rounded-xl text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-sm font-medium"
                      >
                        <span className="text-lg">↩</span>
                        Logout
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <DrawerLink to="/" icon="🏠" label="Home" />
                    <div className="pt-4 space-y-3">
                      <Link
                        to="/login"
                        className="block w-full text-center py-3 rounded-xl border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      >
                        Login
                      </Link>
                      <Link
                        to="/start"
                        className="block w-full text-center py-3 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold transition-colors"
                      >
                        Start Free Trial
                      </Link>
                    </div>
                  </>
                )}
              </div>

              {/* Drawer footer — dark mode toggle */}
              <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {dark ? 'Dark mode' : 'Light mode'}
                </span>
                <DarkModeToggle />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

// ── Drawer nav link helper ─────────────────────────────────────────────────────

function DrawerLink({
  to,
  icon,
  label,
  badge,
}: {
  to: string;
  icon: string;
  label: string;
  badge?: number;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 py-3 px-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
    >
      <span className="text-lg w-7 text-center">{icon}</span>
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white flex-1">
        {label}
      </span>
      {badge !== undefined && (
        <span className="bg-primary-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
          {badge}
        </span>
      )}
    </Link>
  );
}
