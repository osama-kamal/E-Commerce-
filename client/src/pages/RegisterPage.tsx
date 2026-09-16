import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import toast from 'react-hot-toast';
import { Store } from 'lucide-react';
import { authApi } from '../api/auth';
import { setCredentials } from '../store/authSlice';
import { useAppDispatch } from '../hooks/useAppDispatch';
import { useTenant } from '../hooks/useTenant';
import { storeSlugFromRedirect, withRedirect } from '../utils/storeRedirect';

const schema = yup.object({
  email: yup.string().email('Enter a valid email').required('Email is required'),
  password: yup.string().min(8, 'Password must be at least 8 characters').required(),
  confirm: yup.string()
    .oneOf([yup.ref('password')], 'Passwords do not match')
    .required('Please confirm your password'),
});

type FormData = yup.InferType<typeof schema>;

export default function RegisterPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const tenant = useTenant();
  const [searchParams] = useSearchParams();

  // The store this sign-up belongs to. Inside a host storefront it comes from
  // the tenant; on the shared `/register` route it is carried in
  // ?redirect=/s/:slug from the storefront the shopper came from.
  const redirect = searchParams.get('redirect') ?? '';
  const storeSlug = tenant.slug ?? storeSlugFromRedirect(redirect);

  // A customer account is always created IN a store, so registration needs one.
  // Reached bare (someone typed /register, no storefront, no redirect) there is
  // no store to join — the sign-up would fail on submit with a bare-URL 404
  // ("Store not found or inactive", from a stale currentStoreId) or a 400. Show
  // a signpost instead of a form that cannot succeed. Merchants don't register
  // here at all; they onboard at /start.
  const hasStoreContext = tenant.isStorefront || storeSlug !== null;

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: yupResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    try {
      const res = await authApi.register(data.email, data.password, storeSlug ?? undefined);
      // refreshToken is now set as an httpOnly cookie by the backend — not in the response body
      const { user, accessToken } = res.data.data;

      // Keep subsequent requests on this store (the interceptor reads this).
      if ((user as any).storeId) {
        localStorage.setItem('currentStoreId', (user as any).storeId);
      }

      dispatch(setCredentials({ user, accessToken }));
      toast.success('Account created!');
      // Back to the shop they signed up on, not the platform root.
      navigate(storeSlug ? `/s/${storeSlug}` : '/');
    } catch {
      // toast fired by interceptor
    }
  };

  if (!hasStoreContext) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
        <div className="card w-full max-w-md p-8 text-center">
          <span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
            <Store className="h-5 w-5 text-gray-400" aria-hidden="true" />
          </span>
          <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">Open a store to sign up</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            Customer accounts belong to a specific store. Open the store you want to shop
            at and use its <span className="font-medium text-gray-700 dark:text-gray-300">Create account</span> link,
            and your account will be created there.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link to="/" className="btn-primary px-5">Browse stores</Link>
            <Link to="/start" className="btn-secondary px-5">Start your own store</Link>
          </div>
          <p className="mt-6 text-sm text-gray-600 dark:text-gray-400">
            Already have an account?{' '}
            <Link to={withRedirect('/login', redirect)} className="text-primary-600 hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="card w-full max-w-md p-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Create account</h1>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div>
            <label htmlFor="register-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
            <input
              id="register-email"
              type="email"
              className="input"
              autoComplete="email"
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? 'register-email-error' : undefined}
              {...register('email')}
            />
            {errors.email && <p id="register-email-error" role="alert" className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
          </div>
          <div>
            <label htmlFor="register-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
            <input
              id="register-password"
              type="password"
              className="input"
              autoComplete="new-password"
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? 'register-password-error' : undefined}
              {...register('password')}
            />
            {errors.password && <p id="register-password-error" role="alert" className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
          </div>
          <div>
            <label htmlFor="register-confirm" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirm password</label>
            <input
              id="register-confirm"
              type="password"
              className="input"
              autoComplete="new-password"
              aria-invalid={errors.confirm ? true : undefined}
              aria-describedby={errors.confirm ? 'register-confirm-error' : undefined}
              {...register('confirm')}
            />
            {errors.confirm && <p id="register-confirm-error" role="alert" className="text-red-500 text-xs mt-1">{errors.confirm.message}</p>}
          </div>
          <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <p className="mt-4 text-sm text-center text-gray-600 dark:text-gray-400">
          Already have an account?{' '}
          <Link to={withRedirect('/login', redirect)} className="text-primary-600 hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
