import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import toast from 'react-hot-toast';
import { authApi } from '../api/auth';
import { setCredentials, logout } from '../store/authSlice';
import { useAppDispatch } from '../hooks/useAppDispatch';

const schema = yup.object({
  email: yup.string().email('Enter a valid email').required('Email is required'),
  password: yup.string().min(1, 'Password is required').required(),
});

type FormData = yup.InferType<typeof schema>;

export default function LoginPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: yupResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    try {
      // Wipe any stale session state BEFORE the request so there is no window
      // where old credentials can race with the new ones being applied.
      dispatch(logout());

      const res = await authApi.login(data.email, data.password);
      const { user, accessToken } = res.data.data;

      // Persist the user's storeId so the axios interceptor sets X-Store-ID correctly
      if ((user as any).storeId) {
        localStorage.setItem('currentStoreId', (user as any).storeId);
      }

      dispatch(setCredentials({ user, accessToken }));
      toast.success('Welcome back!');
      // super-admin and admin both land on /admin; the sidebar adapts based on role
      navigate(user.role === 'customer' ? '/' : '/admin');
    } catch (err: any) {
      const msg: string =
        err?.response?.data?.message ??
        err?.message ??
        'Login failed. Please check your credentials.';
      toast.error(msg);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-100 via-white to-yellow-100 dark:from-gray-950 dark:via-gray-900 dark:to-amber-950 px-4 relative overflow-hidden">

      {/* Decorative gold orbs — purely visual, no interactivity */}
      <div className="pointer-events-none absolute -top-32 -left-32 w-96 h-96 rounded-full bg-amber-200/50 dark:bg-amber-900/20 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-yellow-200/50 dark:bg-yellow-900/20 blur-3xl" aria-hidden="true" />

      <div className="w-full max-w-md relative z-10">
        {/* Brand mark — amber/gold gradient */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500 to-yellow-600 shadow-lg shadow-amber-200 dark:shadow-amber-900/40 mb-4">
            <span className="text-white text-2xl font-bold">V</span>
          </div>
          <p className="text-sm text-amber-700 dark:text-amber-400 font-medium tracking-wide">Welcome back to Vendbase</p>
        </div>

        {/* Form card — frosted glass with gold border */}
        <div className="bg-white/90 dark:bg-gray-900/90 backdrop-blur-md rounded-2xl shadow-2xl border border-amber-300 dark:border-amber-700/50 p-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Sign in</h1>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
              <input
                id="login-email"
                type="email"
                className="input"
                autoComplete="email"
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={errors.email ? 'login-email-error' : undefined}
                {...register('email')}
              />
              {errors.email && <p id="login-email-error" role="alert" className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
            </div>
            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
              <input
                id="login-password"
                type="password"
                className="input"
                autoComplete="current-password"
                aria-invalid={errors.password ? true : undefined}
                aria-describedby={errors.password ? 'login-password-error' : undefined}
                {...register('password')}
              />
              {errors.password && <p id="login-password-error" role="alert" className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
            </div>

            {/* Sign in button — amber/gold, overrides btn-primary locally */}
            <button
              type="submit"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
              className={`btn btn-brand w-full ${isSubmitting ? 'btn-loading' : ''}`}
            >
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <div className="mt-4 text-sm text-center text-gray-600 dark:text-gray-400">
            <Link to="/forgot-password" className="text-amber-600 hover:text-amber-700 hover:underline dark:text-amber-400">Forgot password?</Link>
            <span className="mx-2">·</span>
            <Link to="/register" className="text-amber-600 hover:text-amber-700 hover:underline dark:text-amber-400">Create account</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
