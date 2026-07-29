/**
 * Does App.tsx's routing shape remount the shared Layout on every navigation?
 *
 * App.tsx wraps each route's element individually:
 *
 *     <Route path="/"     element={<Layout><HomePage /></Layout>} />
 *     <Route path="/cart" element={<Layout><CartPage /></Layout>} />
 *
 * The concern was that each match produces a distinct element tree, remounting
 * Layout on every navigation and re-firing its mount effects (store fetch,
 * wishlist fetch, notifications polling) — three redundant API calls per page
 * change.
 *
 * This reproduces the exact pattern and counts real mounts, rather than
 * reasoning about React Router's reconciliation from the outside.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, ReactNode } from 'react';

const mountSpy = vi.fn();
const effectSpy = vi.fn();

function Layout({ children }: { children?: ReactNode }) {
  useEffect(() => {
    mountSpy();
    // Stands in for fetchCurrentStore() / wishlist fetch / useNotifications().
    effectSpy();
  }, []);
  return (
    <div>
      <nav data-testid="navbar" />
      <main>{children ?? <Outlet />}</main>
    </div>
  );
}

const Home = () => <div data-testid="page">home</div>;
const Cart = () => <div data-testid="page">cart</div>;
const Orders = () => <div data-testid="page">orders</div>;

function Nav() {
  const navigate = useNavigate();
  return (
    <div>
      <button onClick={() => navigate('/')}>go home</button>
      <button onClick={() => navigate('/cart')}>go cart</button>
      <button onClick={() => navigate('/orders')}>go orders</button>
    </div>
  );
}

beforeEach(() => {
  mountSpy.mockClear();
  effectSpy.mockClear();
});

// vitest runs with globals:false, so RTL's automatic afterEach cleanup is not
// registered — unmount explicitly or previous trees leak into the next test.
afterEach(() => {
  cleanup();
});

/** Current shape in App.tsx — Layout wrapped around each element. */
function PerRouteWrapping() {
  return (
    <MemoryRouter initialEntries={['/']}>
      <Nav />
      <Routes>
        <Route path="/" element={<Layout><Home /></Layout>} />
        <Route path="/cart" element={<Layout><Cart /></Layout>} />
        <Route path="/orders" element={<Layout><Orders /></Layout>} />
      </Routes>
    </MemoryRouter>
  );
}

/** Layout route + <Outlet/> — the shape used by the storefront routes. */
function LayoutRoute() {
  return (
    <MemoryRouter initialEntries={['/']}>
      <Nav />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/orders" element={<Orders />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

async function navigateTo(label: string) {
  const btn = screen.getByText(label);
  await act(async () => {
    btn.click();
  });
}

describe('per-route Layout wrapping (App.tsx shape)', () => {
  it('mounts Layout once on first render', () => {
    render(<PerRouteWrapping />);
    expect(mountSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT remount Layout when navigating between routes', async () => {
    render(<PerRouteWrapping />);
    expect(mountSpy).toHaveBeenCalledTimes(1);

    await navigateTo('go cart');
    expect(screen.getByTestId('page').textContent).toBe('cart');

    await navigateTo('go orders');
    expect(screen.getByTestId('page').textContent).toBe('orders');

    await navigateTo('go home');
    expect(screen.getByTestId('page').textContent).toBe('home');

    // React reconciles by component type and position. Layout is the same type
    // at the same position in every branch, so it is UPDATED, not remounted —
    // its mount effects do not re-run.
    expect(mountSpy).toHaveBeenCalledTimes(1);
    expect(effectSpy).toHaveBeenCalledTimes(1);
  });

  it('still swaps the page content on navigation', async () => {
    render(<PerRouteWrapping />);
    await navigateTo('go cart');
    expect(screen.getByTestId('page').textContent).toBe('cart');
  });
});

describe('layout-route + Outlet shape', () => {
  it('also mounts Layout exactly once across navigations', async () => {
    render(<LayoutRoute />);
    expect(mountSpy).toHaveBeenCalledTimes(1);

    await navigateTo('go cart');
    await navigateTo('go orders');

    expect(mountSpy).toHaveBeenCalledTimes(1);
  });

  it('renders the matched child through the Outlet', async () => {
    render(<LayoutRoute />);
    await navigateTo('go orders');
    expect(screen.getByTestId('page').textContent).toBe('orders');
  });
});
