import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell, Heart, Home, LayoutDashboard, LogOut, type LucideIcon, Menu, Moon,
  Package, Search, ShoppingCart, Sun, User, X,
} from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../hooks/useAppDispatch';
import { logoutThunk } from '../store/authSlice';
import { useDarkMode } from '../hooks/useDarkMode';
import NotificationDropdown from './NotificationDropdown';

// Reusable spring config for tap animations
const TAP_SPRING = { type: 'spring', stiffness: 400, damping: 10 } as const;

/**
 * Desktop nav link with an explicit active state.
 *
 * The bar previously gave no indication of the current page — every link looked
 * identical on every route.
 */
function NavItem({ to, label, active }: { to: string; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
        active
          ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'
      }`}
    >
      {label}
    </Link>
  );
}

/** Row inside the profile dropdown. */
function MenuItem({
  to, icon: Icon, label, onClick,
}: { to: string; icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      role="menuitem"
      className="group flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
    >
      <Icon className="h-4 w-4 shrink-0 text-gray-400 transition-colors group-hover:text-gray-900 dark:group-hover:text-white" aria-hidden="true" />
      {label}
    </Link>
  );
}

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

  // Navbar search. Submits to the SAME `?search=` URL contract HomePage already
  // reads on mount — no new route, no new state owner, no API call from here.
  const [navSearch, setNavSearch] = useState('');
  const handleNavSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = navSearch.trim();
    navigate(q ? `/?search=${encodeURIComponent(q)}` : '/');
    setDrawerOpen(false);
  };

  // Scroll state drives the glass/shadow transition. A bare `sticky` bar with a
  // permanent border looks identical whether the page is at the top or scrolled;
  // the transition is what tells the user the bar is floating over content.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Exact match for "/" so it is not permanently active; prefix match elsewhere.
  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

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
      // Track colour moved off indigo — it was the only indigo left in the
      // chrome once the CTA banner was unified, and it read as a stray accent.
      className={`relative w-14 h-7 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
        dark ? 'bg-gray-700' : 'bg-gray-200'
      } ${className}`}
    >
      {/* Rail icons: emoji rendered at different optical sizes on each OS, so
          the two sides of the track never looked balanced. Lucide glyphs share
          a grid and stroke weight. */}
      <Moon className="pointer-events-none absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" aria-hidden="true" />
      <Sun className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-amber-500" aria-hidden="true" />
      <span
        className={`absolute top-0.5 flex h-6 w-6 transform items-center justify-center rounded-full bg-white shadow-md transition-transform duration-200 ${
          dark ? 'translate-x-7' : 'translate-x-0.5'
        }`}
      >
        {dark
          ? <Moon className="h-3.5 w-3.5 text-gray-700" aria-hidden="true" />
          : <Sun className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />}
      </span>
    </button>
  );

  return (
    <>
      {/* Translucent + blurred only once the page has moved. At rest the bar is
          opaque and borderless so it reads as part of the page; on scroll it
          lifts with glass and a hairline. */}
      <nav
        className={`sticky top-0 z-50 transition-all duration-200 ${
          scrolled
            ? 'border-b border-gray-200/70 bg-white/80 shadow-soft backdrop-blur-xl dark:border-gray-800/70 dark:bg-gray-900/80'
            : 'border-b border-transparent bg-white dark:bg-gray-900'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className={`flex items-center gap-4 transition-all duration-200 ${scrolled ? 'h-14' : 'h-16'}`}>

            {/* ── Store branding ── */}
            <Link
              to="/"
              className="flex shrink-0 items-center gap-2.5 text-[17px] font-bold tracking-tight text-gray-900 dark:text-white"
            >
              {storeLogo && storeLogo.startsWith('http') ? (
                <img
                  src={storeLogo}
                  alt={storeName}
                  className="h-8 w-8 rounded-lg object-contain"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : null}
              <span>{storeName}</span>
            </Link>

            {/* ── Desktop search ──
                Navigates to the existing `/?search=` URL that HomePage already
                parses. No new route, no new API call. */}
            <form onSubmit={handleNavSearch} className="hidden flex-1 justify-center lg:flex" role="search">
              <div className="relative w-full max-w-md">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                <input
                  type="search"
                  value={navSearch}
                  onChange={e => setNavSearch(e.target.value)}
                  placeholder="Search products…"
                  aria-label="Search products"
                  className="w-full rounded-full border border-gray-200 bg-gray-50 py-2 pl-10 pr-4 text-sm outline-none transition-all placeholder:text-gray-400 hover:bg-gray-100 focus:border-gray-900 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-750 dark:focus:border-gray-400"
                />
              </div>
            </form>

            {/* ── Desktop nav (hidden on mobile) ── */}
            <div className="hidden md:flex items-center gap-1">
              <NavItem to="/" label="Home" active={isActive('/')} />

              {isAuthenticated ? (
                <>
                  {/* Cart — icon with a counter badge. The old text link "Cart"
                      with a floating number needed reading; a glyph is scanned. */}
                  <MotionLink
                    to="/cart"
                    whileTap={{ y: -3 }}
                    transition={TAP_SPRING}
                    aria-label={`Cart, ${cartCount} items`}
                    className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                      isActive('/cart')
                        ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
                        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white'
                    }`}
                  >
                    <motion.span
                      key={cartLastUpdated}
                      animate={cartLastUpdated > 0 ? { y: [0, -5, 0] } : {}}
                      transition={{ duration: 0.35, ease: 'easeOut' }}
                      className="inline-flex"
                    >
                      <ShoppingCart className="h-[18px] w-[18px]" aria-hidden="true" />
                    </motion.span>
                    <AnimatePresence>
                      {cartCount > 0 && (
                        <motion.span
                          key={cartCount}
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          exit={{ scale: 0 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                          className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-gray-900"
                        >
                          {cartCount}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </MotionLink>

                  <MotionLink
                    to="/wishlist"
                    whileTap={{ y: -3 }}
                    transition={TAP_SPRING}
                    aria-label="Wishlist"
                    className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                      isActive('/wishlist')
                        ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
                        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white'
                    }`}
                  >
                    <Heart className="h-[18px] w-[18px]" aria-hidden="true" />
                  </MotionLink>

                  <NotificationDropdown />

                  {user?.role === 'admin' && (
                    <Link
                      to="/admin"
                      className="ml-1 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
                    >
                      Admin
                    </Link>
                  )}

                  {/* User avatar dropdown */}
                  <div className="relative" ref={menuRef}>
                    <motion.button
                      whileTap={{ y: -5 }}
                      transition={TAP_SPRING}
                      onClick={() => setMenuOpen(o => !o)}
                      className="ml-1 flex h-9 w-9 items-center justify-center rounded-full bg-gray-900 text-[11px] font-bold text-white ring-2 ring-transparent transition-all hover:ring-gray-200 dark:bg-white dark:text-gray-900 dark:hover:ring-gray-700"
                      aria-label="User menu"
                      aria-expanded={menuOpen}
                      aria-haspopup="menu"
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
                          role="menu"
                          // `.surface` instead of `.card`: the menu overlays page
                          // content, and .card's translucency let text bleed
                          // through from behind it.
                          className="surface absolute right-0 z-50 mt-2 w-60 overflow-hidden p-1.5 shadow-float"
                        >
                          <div className="mb-1 border-b border-gray-100 px-3 py-2.5 dark:border-gray-800">
                            <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Signed in as</p>
                            <p className="truncate text-[13px] font-semibold text-gray-900 dark:text-white">{user?.email}</p>
                          </div>
                          <MenuItem to="/profile" icon={User} label="Profile" onClick={() => setMenuOpen(false)} />
                          <MenuItem to="/orders" icon={Package} label="My Orders" onClick={() => setMenuOpen(false)} />
                          <MenuItem to="/wishlist" icon={Heart} label="Wishlist" onClick={() => setMenuOpen(false)} />
                          <div className="mt-1 border-t border-gray-100 pt-1 dark:border-gray-800">
                            <button
                              onClick={handleLogout}
                              role="menuitem"
                              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                            >
                              <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
                              Logout
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </>
              ) : (
                <>
                  <Link
                    to="/login"
                    className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
                  >
                    Login
                  </Link>
                  {/* Near-black rather than blue: the only blue left in the
                      chrome was fighting the amber storefront accent. */}
                  <Link
                    to="/start"
                    className="ml-1 rounded-lg bg-gray-900 px-4 py-2 text-[13px] font-semibold text-white transition-all hover:bg-gray-800 hover:shadow-elevated dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                  >
                    Start Free Trial
                  </Link>
                </>
              )}

              <div className="ml-2 border-l border-gray-200 pl-3 dark:border-gray-800">
                <DarkModeToggle />
              </div>
            </div>

            {/* ── Mobile right side: cart icon + hamburger ── */}
            <div className="ml-auto flex items-center gap-1 md:hidden">
              {/* Cart icon — always visible on mobile so users can tap it quickly */}
              {isAuthenticated && (
                <Link
                  to="/cart"
                  className="relative flex h-11 w-11 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  aria-label={`Cart, ${cartCount} items`}
                >
                  <ShoppingCart className="h-5 w-5" aria-hidden="true" />
                  {cartCount > 0 && (
                    <span className="absolute right-1.5 top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white dark:ring-gray-900">
                      {cartCount}
                    </span>
                  )}
                </Link>
              )}

              {/* Hamburger — 44×44 touch target. The three hand-built spans are
                  replaced by one icon so it shares the stroke weight of every
                  other glyph in the bar. */}
              <button
                onClick={() => setDrawerOpen(true)}
                aria-label="Open menu"
                aria-expanded={drawerOpen}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <Menu className="h-5 w-5" aria-hidden="true" />
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
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
                <span className="text-[17px] font-bold tracking-tight text-gray-900 dark:text-white">{storeName}</span>
                <button
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close menu"
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>

              {/* Mobile search — the desktop field is hidden below lg, so without
                  this there was no way to search from a phone except scrolling
                  to the grid. Same `/?search=` contract. */}
              <form onSubmit={handleNavSearch} className="border-b border-gray-100 px-5 py-3 dark:border-gray-800" role="search">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                  <input
                    type="search"
                    value={navSearch}
                    onChange={e => setNavSearch(e.target.value)}
                    placeholder="Search products…"
                    aria-label="Search products"
                    className="w-full rounded-full border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-gray-400 focus:border-gray-900 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-gray-400"
                  />
                </div>
              </form>

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
                    <DrawerLink to="/" icon={Home} label="Home" />
                    <DrawerLink to="/cart" icon={ShoppingCart} label="Cart" badge={cartCount > 0 ? cartCount : undefined} />
                    <DrawerLink to="/wishlist" icon={Heart} label="Wishlist" />
                    <DrawerLink to="/orders" icon={Package} label="My Orders" />
                    <DrawerLink to="/profile" icon={User} label="Profile" />

                    {user?.role === 'admin' && (
                      <DrawerLink to="/admin" icon={LayoutDashboard} label="Admin Dashboard" />
                    )}

                    {/* Notifications row */}
                    <div className="mt-2 flex items-center gap-3 border-t border-gray-100 py-3 dark:border-gray-800">
                      <Bell className="h-[18px] w-[18px] shrink-0 text-gray-400" aria-hidden="true" />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Notifications</span>
                      <div className="ml-auto">
                        <NotificationDropdown />
                      </div>
                    </div>

                    <div className="border-t border-gray-100 pt-2 dark:border-gray-800">
                      <button
                        onClick={handleLogout}
                        className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                      >
                        <LogOut className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                        Logout
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <DrawerLink to="/" icon={Home} label="Home" />
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

// `icon` is now a component rather than an emoji string: emoji rendered at a
// different optical size per glyph, so the drawer's icon column never lined up.
function DrawerLink({
  to,
  icon: Icon,
  label,
  badge,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  badge?: number;
}) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
    >
      <Icon className="h-[18px] w-[18px] shrink-0 text-gray-400 transition-colors group-hover:text-gray-900 dark:group-hover:text-white" aria-hidden="true" />
      <span className="flex-1 text-sm font-medium text-gray-700 transition-colors group-hover:text-gray-900 dark:text-gray-300 dark:group-hover:text-white">
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
