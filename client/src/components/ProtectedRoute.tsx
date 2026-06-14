import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../hooks/useAppDispatch';
import { logout } from '../store/authSlice';

interface Props {
  requiredRole?: 'admin' | 'customer';
}

/**
 * Decode the role claim from the JWT without verifying the signature.
 * CLIENT-SIDE ONLY — not a security gate. Used as a fallback when the Redux
 * `user` object is null or stale (e.g. overwritten by a storefront login).
 */
function getRoleFromJwt(): 'super-admin' | 'admin' | 'customer' | null {
  try {
    const token = localStorage.getItem('accessToken');
    if (!token) return null;
    const payload = JSON.parse(atob(token.split('.')[1]));
    const role = payload?.role;
    return role === 'super-admin' || role === 'admin' || role === 'customer' ? role : null;
  } catch {
    return null;
  }
}

export default function ProtectedRoute({ requiredRole }: Props) {
  const { isAuthenticated, user } = useAppSelector((s) => s.auth);
  const dispatch = useAppDispatch();
  const location = useLocation();

  const reduxRole = user?.role ?? null;
  const jwtRole   = getRoleFromJwt();
  const resolvedRole = reduxRole ?? jwtRole;

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  if (requiredRole) {
    // super-admin passes ALL role checks — they're a superset of admin
    const passes =
      resolvedRole === 'super-admin' ||
      resolvedRole === requiredRole;

    if (!passes) {
      // If the JWT says a higher role but Redux/localStorage disagrees,
      // the session is stale. Clear it so the user can re-authenticate.
      if (
        (jwtRole === 'super-admin' || jwtRole === requiredRole) &&
        reduxRole !== jwtRole
      ) {
        dispatch(logout());
        return <Navigate to="/login" replace />;
      }

      return <Navigate to="/" replace />;
    }
  }

  return <Outlet />;
}
