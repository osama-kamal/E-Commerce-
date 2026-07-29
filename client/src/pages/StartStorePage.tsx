import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppDispatch } from '../hooks/useAppDispatch';
import { setCredentials } from '../store/authSlice';
import { onboardingApi } from '../api/onboarding';

// ── Shared step animation variants ───────────────────────────────────────────

const stepVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 24 : -24, opacity: 0 }),
  center: { x: 0, opacity: 1, transition: { duration: 0.28, ease: 'easeOut' } },
  exit:  (dir: number) => ({ x: dir > 0 ? -24 : 24, opacity: 0, transition: { duration: 0.2, ease: 'easeIn' } }),
};

// ── Validation schema ─────────────────────────────────────────────────────────

const schema = yup.object({
  fullName: yup.string().min(2, 'At least 2 characters').max(100).required('Full name is required'),
  email: yup.string().email('Enter a valid email').required('Email is required'),
  password: yup
    .string()
    .min(8, 'At least 8 characters')
    .matches(/[A-Z]/, 'Include at least one uppercase letter')
    .matches(/[0-9]/, 'Include at least one number')
    .required('Password is required'),
  storeName: yup.string().min(2, 'At least 2 characters').max(100).required('Store name is required'),
  storeCategory: yup.string().required('Pick a category'),
});

type FormData = yup.InferType<typeof schema>;

// ── Store categories ──────────────────────────────────────────────────────────

const CATEGORIES = [
  { value: 'fashion',     label: 'Fashion & Apparel',   icon: '👗' },
  { value: 'electronics', label: 'Electronics',          icon: '💻' },
  { value: 'home',        label: 'Home & Living',        icon: '🏠' },
  { value: 'beauty',      label: 'Beauty & Care',        icon: '💄' },
  { value: 'sports',      label: 'Sports & Fitness',     icon: '⚽' },
  { value: 'food',        label: 'Food & Beverages',     icon: '🍕' },
  { value: 'books',       label: 'Books & Education',    icon: '📚' },
  { value: 'toys',        label: 'Toys & Kids',          icon: '🧸' },
  { value: 'jewelry',     label: 'Jewelry & Accessories',icon: '💍' },
  { value: 'other',       label: 'Other',                icon: '🛍️' },
];

// ── Step indicator ────────────────────────────────────────────────────────────

function StepDot({ step, current, label }: { step: number; current: number; label: string }) {
  const done = current > step;
  const active = current === step;
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 ${
          done
            ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30'
            : active
            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/40 scale-110'
            : 'bg-white/10 text-white/40 border border-white/20'
        }`}
      >
        {done ? '✓' : step}
      </div>
      <span className={`text-xs font-medium hidden sm:block ${active ? 'text-white' : 'text-white/40'}`}>
        {label}
      </span>
    </div>
  );
}

function StepLine({ done }: { done: boolean }) {
  return (
    <div className="flex-1 h-px mx-2 mt-[-18px] sm:mt-[-22px] transition-all duration-500">
      <div className={`h-full transition-all duration-500 ${done ? 'bg-emerald-500' : 'bg-white/15'}`} />
    </div>
  );
}

// ── Password strength ─────────────────────────────────────────────────────────

function PasswordStrength({ password }: { password: string }) {
  const checks = [
    { label: '8+ characters', ok: password.length >= 8 },
    { label: 'Uppercase',     ok: /[A-Z]/.test(password) },
    { label: 'Number',        ok: /[0-9]/.test(password) },
  ];
  const score = checks.filter(c => c.ok).length;
  const colors = ['bg-red-500', 'bg-amber-400', 'bg-emerald-500'];
  const labels = ['Weak', 'Fair', 'Strong'];

  if (!password) return null;

  return (
    <div className="mt-2 space-y-2">
      <div className="flex gap-1">
        {[0, 1, 2].map(i => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-all duration-300 ${i < score ? colors[score - 1] : 'bg-white/10'}`} />
        ))}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex gap-3">
          {checks.map(c => (
            <span key={c.label} className={`text-xs flex items-center gap-1 ${c.ok ? 'text-emerald-400' : 'text-white/30'}`}>
              <span>{c.ok ? '✓' : '○'}</span> {c.label}
            </span>
          ))}
        </div>
        {score > 0 && (
          <span className={`text-xs font-semibold ${colors[score - 1].replace('bg-', 'text-')}`}>
            {labels[score - 1]}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Slug preview ──────────────────────────────────────────────────────────────

function slugify(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 40);
}

// ── Success screen ────────────────────────────────────────────────────────────

function SuccessScreen({ storeName, onContinue }: { storeName: string; onContinue: () => void }) {
  useEffect(() => {
    const t = setTimeout(onContinue, 3000);
    return () => clearTimeout(t);
  }, [onContinue]);

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center space-y-6 animate-fade-in">
      <div className="relative">
        <div className="w-24 h-24 rounded-full bg-emerald-500/20 flex items-center justify-center animate-pulse">
          <div className="w-16 h-16 rounded-full bg-emerald-500/30 flex items-center justify-center">
            <span className="text-4xl">🎉</span>
          </div>
        </div>
        <div className="absolute -top-1 -right-1 w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-white text-lg font-bold shadow-lg shadow-emerald-500/50">
          ✓
        </div>
      </div>
      <div>
        <h2 className="text-3xl font-bold text-white mb-2">Your store is live!</h2>
        <p className="text-white/60 text-lg">
          <span className="text-indigo-300 font-semibold">{storeName}</span> is ready to go.
        </p>
      </div>
      <p className="text-white/40 text-sm">Redirecting to your dashboard…</p>
      <div className="w-48 h-1 bg-white/10 rounded-full overflow-hidden">
        <div className="h-full bg-emerald-500 rounded-full animate-[grow_3s_linear_forwards]" style={{ width: '0%', animation: 'none', transition: 'width 3s linear' }} ref={el => { if (el) setTimeout(() => { el.style.width = '100%'; }, 50); }} />
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function StartStorePage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [dir, setDir] = useState(1); // 1 = forward, -1 = backward
  const [success, setSuccess] = useState(false);
  const [createdStoreName, setCreatedStoreName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: yupResolver(schema), mode: 'onTouched' });

  const watchedPassword = watch('password', '');
  const watchedStoreName = watch('storeName', '');
  const watchedCategory = watch('storeCategory', '');

  const goNext = async () => {
    const fields: (keyof FormData)[] = step === 1
      ? ['fullName', 'email', 'password']
      : ['storeName', 'storeCategory'];
    const valid = await trigger(fields);
    if (!valid) return;
    setDir(1);
    setStep(s => s + 1);
  };

  const onSubmit = async (data: FormData) => {
    try {
      const res = await onboardingApi.createStore({
        fullName: data.fullName,
        email: data.email,
        password: data.password,
        storeName: data.storeName,
        storeCategory: data.storeCategory,
      });

      const { store, user, accessToken } = res.data.data;
      // refreshToken is now set as an httpOnly cookie by the backend — not in the response body

      // Set currentStoreId FIRST — the axios interceptor reads this on every request.
      localStorage.setItem('currentStoreId', store._id);
      localStorage.setItem('accessToken', accessToken);

      dispatch(setCredentials({
        user: { ...user, storeId: store._id } as any,
        accessToken,
      }));

      setCreatedStoreName(store.name);
      setSuccess(true);
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? 'Something went wrong. Please try again.';
      toast.error(msg);
    }
  };

  const handleContinue = () => navigate('/admin');

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0a0a1a] flex">
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-[45%] xl:w-[40%] flex-col justify-between p-12 bg-gradient-to-br from-indigo-950 via-[#0d0d2b] to-[#0a0a1a] border-r border-white/5">
        <div>
          <Link to="/" className="flex items-center gap-2 text-white font-bold text-xl">
            <span className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-sm">V</span>
            Vendbase
          </Link>
        </div>

        <div className="space-y-8">
          <div>
            <h1 className="text-4xl xl:text-5xl font-bold text-white leading-tight">
              Launch your store<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">
                in minutes.
              </span>
            </h1>
            <p className="mt-4 text-white/50 text-lg leading-relaxed">
              Everything you need to sell online — products, orders, analytics, and more.
            </p>
          </div>

          <div className="space-y-4">
            {[
              { icon: '⚡', title: 'Instant setup', desc: 'Your store is live the moment you sign up' },
              { icon: '📊', title: 'Built-in analytics', desc: 'Track revenue, orders, and customers in real time' },
              { icon: '🔒', title: 'Secure by default', desc: 'Multi-tenant isolation keeps your data safe' },
            ].map(f => (
              <div key={f.title} className="flex items-start gap-4 p-4 rounded-xl bg-white/5 border border-white/8">
                <span className="text-2xl mt-0.5">{f.icon}</span>
                <div>
                  <p className="text-white font-semibold text-sm">{f.title}</p>
                  <p className="text-white/40 text-xs mt-0.5">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-white/20 text-xs">© 2026 Vendbase. All rights reserved.</p>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-10 overflow-y-auto">
        <div className="w-full max-w-lg">

          {/* Mobile logo */}
          <div className="lg:hidden mb-8 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-sm font-bold">V</span>
            <span className="text-white font-bold text-xl">Vendbase</span>
          </div>

          {success ? (
            <SuccessScreen storeName={createdStoreName} onContinue={handleContinue} />
          ) : (
            <>
              {/* Header */}
              <div className="mb-8">
                <h2 className="text-2xl sm:text-3xl font-bold text-white">Start your store</h2>
                <p className="text-white/40 mt-1 text-sm">Free forever. No credit card required.</p>
              </div>

              {/* Step indicator */}
              <div className="flex items-center mb-10">
                <StepDot step={1} current={step} label="Account" />
                <StepLine done={step > 1} />
                <StepDot step={2} current={step} label="Store" />
                <StepLine done={step > 2} />
                <StepDot step={3} current={step} label="Review" />
              </div>

              <form onSubmit={handleSubmit(onSubmit)} noValidate>

                {/* ── AnimatePresence: one always-present motion.div keyed on step ── */}
                {/* Direct children of AnimatePresence must NOT be conditionally      */}
                {/* rendered — the key change is what triggers exit → enter.          */}
                <AnimatePresence mode="wait" custom={dir}>
                  <motion.div
                    key={step}
                    custom={dir}
                    variants={stepVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                  >
                {/* ── Step 1: Account ─────────────────────────────────── */}
                {step === 1 && (
                  <div className="space-y-5">
                    <div>
                      <label htmlFor="onboard-fullname" className="block text-sm font-medium text-white/70 mb-1.5">Full name</label>
                      <input
                        id="onboard-fullname"
                        type="text"
                        placeholder="Alex Johnson"
                        autoComplete="name"
                        aria-invalid={errors.fullName ? true : undefined}
                        aria-describedby={errors.fullName ? 'onboard-fullname-error' : undefined}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                        {...register('fullName')}
                      />
                      {errors.fullName && <p id="onboard-fullname-error" role="alert" className="text-red-400 text-xs mt-1.5">{errors.fullName.message}</p>}
                    </div>

                    <div>
                      <label htmlFor="onboard-email" className="block text-sm font-medium text-white/70 mb-1.5">Email address</label>
                      <input
                        id="onboard-email"
                        type="email"
                        placeholder="alex@example.com"
                        autoComplete="email"
                        aria-invalid={errors.email ? true : undefined}
                        aria-describedby={errors.email ? 'onboard-email-error' : undefined}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                        {...register('email')}
                      />
                      {errors.email && <p id="onboard-email-error" role="alert" className="text-red-400 text-xs mt-1.5">{errors.email.message}</p>}
                    </div>

                    <div>
                      <label htmlFor="onboard-password" className="block text-sm font-medium text-white/70 mb-1.5">Password</label>
                      <div className="relative">
                        <input
                          id="onboard-password"
                          type={showPassword ? 'text' : 'password'}
                          placeholder="Min. 8 characters"
                          autoComplete="new-password"
                          aria-invalid={errors.password ? true : undefined}
                          aria-describedby={errors.password ? 'onboard-password-error' : undefined}
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-12 text-white placeholder-white/20 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                          {...register('password')}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(v => !v)}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          aria-pressed={showPassword}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors text-sm"
                        >
                          {showPassword ? '🙈' : '👁️'}
                        </button>
                      </div>
                      <PasswordStrength password={watchedPassword} />
                      {errors.password && <p id="onboard-password-error" role="alert" className="text-red-400 text-xs mt-1.5">{errors.password.message}</p>}
                    </div>

                    <button
                      type="button"
                      onClick={goNext}
                      className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-all duration-200 shadow-lg shadow-indigo-600/30 hover:shadow-indigo-500/40 hover:-translate-y-0.5 active:translate-y-0"
                    >
                      Continue →
                    </button>

                    <p className="text-center text-white/30 text-sm">
                      Already have a store?{' '}
                      <Link to="/login" className="text-indigo-400 hover:text-indigo-300 transition-colors">
                        Sign in
                      </Link>
                    </p>
                  </div>
                )}

                {/* ── Step 2: Store ────────────────────────────────────── */}
                {step === 2 && (
                  <div className="space-y-6">
                    <div>
                      <label htmlFor="onboard-storename" className="block text-sm font-medium text-white/70 mb-1.5">Store name</label>
                      <input
                        id="onboard-storename"
                        type="text"
                        placeholder="My Awesome Store"
                        autoComplete="organization"
                        aria-invalid={errors.storeName ? true : undefined}
                        aria-describedby={errors.storeName ? 'onboard-storename-error' : undefined}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                        {...register('storeName')}
                      />
                      {watchedStoreName && (
                        <p className="text-white/30 text-xs mt-1.5 flex items-center gap-1">
                          <span className="text-white/20">URL:</span>
                          <span className="text-indigo-400 font-mono">{slugify(watchedStoreName)}.vendbase.com</span>
                        </p>
                      )}
                      {errors.storeName && <p id="onboard-storename-error" role="alert" className="text-red-400 text-xs mt-1.5">{errors.storeName.message}</p>}
                    </div>

                    {/* Radio group: a <fieldset>/<legend> is the correct grouping
                        semantic so screen readers announce "Store category" once
                        before reading the options, instead of treating each tile
                        as an unrelated control. */}
                    <fieldset
                      aria-invalid={errors.storeCategory ? true : undefined}
                      aria-describedby={errors.storeCategory ? 'onboard-category-error' : undefined}
                    >
                      <legend className="block text-sm font-medium text-white/70 mb-3">Store category</legend>
                      <div className="grid grid-cols-2 gap-2">
                        {CATEGORIES.map(cat => (
                          <label
                            key={cat.value}
                            className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all duration-200 ${
                              watchedCategory === cat.value
                                ? 'border-indigo-500 bg-indigo-500/15 shadow-sm shadow-indigo-500/20'
                                : 'border-white/8 bg-white/3 hover:border-white/20 hover:bg-white/6'
                            }`}
                          >
                            <input type="radio" value={cat.value} {...register('storeCategory')} className="sr-only" />
                            <span className="text-xl">{cat.icon}</span>
                            <span className={`text-xs font-medium leading-tight ${watchedCategory === cat.value ? 'text-indigo-300' : 'text-white/50'}`}>
                              {cat.label}
                            </span>
                          </label>
                        ))}
                      </div>
                      {errors.storeCategory && <p id="onboard-category-error" role="alert" className="text-red-400 text-xs mt-2">{errors.storeCategory.message}</p>}
                    </fieldset>

                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => { setDir(-1); setStep(1); }}
                        className="flex-1 py-3.5 rounded-xl border border-white/10 text-white/60 hover:text-white hover:border-white/20 font-semibold transition-all duration-200"
                      >
                        ← Back
                      </button>
                      <button
                        type="button"
                        onClick={goNext}
                        className="flex-[2] py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-all duration-200 shadow-lg shadow-indigo-600/30 hover:-translate-y-0.5 active:translate-y-0"
                      >
                        Review →
                      </button>
                    </div>
                  </div>
                )}

                {/* ── Step 3: Review & Submit ──────────────────────────── */}
                {step === 3 && (
                  <div className="space-y-6">
                    <div className="rounded-2xl border border-white/10 bg-white/3 overflow-hidden">
                      <div className="px-5 py-4 border-b border-white/8">
                        <p className="text-white/40 text-xs uppercase tracking-widest font-semibold">Account</p>
                      </div>
                      <div className="px-5 py-4 space-y-3">
                        <Row label="Name" value={watch('fullName')} />
                        <Row label="Email" value={watch('email')} />
                        <Row label="Password" value="••••••••" />
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/3 overflow-hidden">
                      <div className="px-5 py-4 border-b border-white/8">
                        <p className="text-white/40 text-xs uppercase tracking-widest font-semibold">Store</p>
                      </div>
                      <div className="px-5 py-4 space-y-3">
                        <Row label="Name" value={watch('storeName')} />
                        <Row label="URL" value={`${slugify(watch('storeName'))}.vendbase.com`} accent />
                        <Row
                          label="Category"
                          value={CATEGORIES.find(c => c.value === watch('storeCategory'))?.label ?? '—'}
                        />
                        <Row label="Plan" value="Free forever" badge />
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => { setDir(-1); setStep(2); }}
                        className="flex-1 py-3.5 rounded-xl border border-white/10 text-white/60 hover:text-white hover:border-white/20 font-semibold transition-all duration-200"
                      >
                        ← Back
                      </button>
                      <motion.button
                        type="submit"
                        disabled={isSubmitting}
                        whileHover={!isSubmitting ? { scale: 1.02 } : undefined}
                        whileTap={!isSubmitting ? { scale: 0.98 } : undefined}
                        className="flex-[2] py-3.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold transition-all duration-200 shadow-lg shadow-indigo-600/30 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {isSubmitting ? (
                          <>
                            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Creating your store…
                          </>
                        ) : (
                          '🚀 Launch my store'
                        )}
                      </motion.button>
                    </div>

                    <p className="text-center text-white/20 text-xs">
                      By continuing you agree to our{' '}
                      <span className="text-white/40 underline cursor-pointer">Terms of Service</span>
                      {' '}and{' '}
                      <span className="text-white/40 underline cursor-pointer">Privacy Policy</span>.
                    </p>
                  </div>
                )}

                  </motion.div>
                </AnimatePresence>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helper component ──────────────────────────────────────────────────────────

function Row({ label, value, accent, badge }: { label: string; value: string; accent?: boolean; badge?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/40 text-sm">{label}</span>
      {badge ? (
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
          {value}
        </span>
      ) : (
        <span className={`text-sm font-medium ${accent ? 'text-indigo-400 font-mono' : 'text-white'}`}>{value}</span>
      )}
    </div>
  );
}
