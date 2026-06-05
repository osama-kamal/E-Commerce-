import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import toast from 'react-hot-toast';
import { authApi } from '../api/auth';
import { setCredentials } from '../store/authSlice';
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
      const res = await authApi.login(data.email, data.password);
      // refreshToken is now set as an httpOnly cookie by the backend — not in the response body
      const { user, accessToken } = res.data.data;

      // Persist the user's storeId — the axios interceptor uses this for X-Store-ID
      if ((user as any).storeId) {
        localStorage.setItem('currentStoreId', (user as any).storeId);
      }

      dispatch(setCredentials({ user, accessToken }));
      toast.success(`Welcome back!`);
      navigate(user.role === 'admin' ? '/admin' : '/');
    } catch {
      // toast is fired by axios interceptor
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="card w-full max-w-md p-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Sign in</h1>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
            <input type="email" className="input" {...register('email')} />
            {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
            <input type="password" className="input" {...register('password')} />
            {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
          </div>
          <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="mt-4 text-sm text-center text-gray-600 dark:text-gray-400">
          <Link to="/forgot-password" className="text-primary-600 hover:underline">Forgot password?</Link>
          <span className="mx-2">·</span>
          <Link to="/register" className="text-primary-600 hover:underline">Create account</Link>
        </div>
      </div>
    </div>
  );
}
