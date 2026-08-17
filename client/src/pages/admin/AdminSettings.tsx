import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../hooks/useAppDispatch';
import { fetchCurrentStore, setCurrentStore } from '../../store/storeSlice';
import { storesApi } from '../../api/stores';
import ThemePicker from '../../components/ThemePicker';
import { getThemeMeta, resolveTheme, type StoreTheme } from '../../theme/themes';
import { CardGridSkeleton } from '../../components/Skeleton';
import { Store } from '../../types';
import toast from 'react-hot-toast';

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="card p-6">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
      </div>
      {children}
    </div>
  );
}

// ── Input row ─────────────────────────────────────────────────────────────────

/**
 * `htmlFor` associates the caption with its control. The caption was previously
 * a <p>, so screen readers had no way to connect it to the input beside it and
 * clicking it did not focus the field.
 *
 * `block` is added explicitly because <label> is inline by default where <p> is
 * block — without it the hint below would reflow. Rendering is unchanged.
 */
function Field({ label, hint, htmlFor, children }: {
  label: string; hint?: string; htmlFor?: string; children: React.ReactNode;
}) {
  const hintId = htmlFor ? `${htmlFor}-hint` : undefined;
  return (
    <div className="grid sm:grid-cols-3 gap-3 items-start py-4 border-b dark:border-gray-800 last:border-0">
      <div>
        <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
        {hint && <p id={hintId} className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <div className="sm:col-span-2">{children}</div>
    </div>
  );
}

// ── Social input with icon ────────────────────────────────────────────────────

/**
 * The emoji conveys the network visually but is meaningless to a screen reader,
 * so it is hidden from the accessibility tree and the input carries an explicit
 * `aria-label` (e.g. "Facebook page URL") instead.
 */
function SocialInput({ icon, network, placeholder, value, onChange }: {
  icon: string; network: string; placeholder: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xl w-7 shrink-0" aria-hidden="true">{icon}</span>
      <input
        type="url"
        className="input flex-1"
        placeholder={placeholder}
        aria-label={`${network} URL`}
        autoComplete="url"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminSettings() {
  const dispatch = useAppDispatch();
  const currentStore = useAppSelector(s => s.currentStore.current);
  const storeLoading = useAppSelector(s => s.currentStore.loading);

  const [form, setForm] = useState({
    name: '',
    contactEmail: '',
    contactPhone: '',
    facebook: '',
    instagram: '',
    twitter: '',
    tiktok: '',
    youtube: '',
  });

  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  /** Which theme is mid-write, so the picker can show a spinner and block clicks. */
  const [savingTheme, setSavingTheme] = useState<StoreTheme | null>(null);
  const [savingTaxMode, setSavingTaxMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load store data
  useEffect(() => {
    dispatch(fetchCurrentStore());
  }, [dispatch]);

  // Populate form when store loads
  useEffect(() => {
    if (currentStore) {
      setForm({
        name: currentStore.name ?? '',
        contactEmail: currentStore.settings?.contactEmail ?? '',
        contactPhone: currentStore.settings?.contactPhone ?? '',
        facebook: currentStore.settings?.facebook ?? '',
        instagram: currentStore.settings?.instagram ?? '',
        twitter: currentStore.settings?.twitter ?? '',
        tiktok: currentStore.settings?.tiktok ?? '',
        youtube: currentStore.settings?.youtube ?? '',
      });
      if (currentStore.settings?.logoUrl) {
        setLogoPreview(currentStore.settings.logoUrl);
      }
    }
  }, [currentStore]);

  const set = (field: keyof typeof form) => (value: string) =>
    setForm(f => ({ ...f, [field]: value }));

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Logo must be under 5MB'); return; }
    setLogoFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setLogoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleUploadLogo = async () => {
    if (!logoFile || !currentStore) return;
    setUploadingLogo(true);
    try {
      const imageUrl = await storesApi.uploadLogo(currentStore._id, logoFile);
      setLogoPreview(imageUrl);
      setLogoFile(null);
      // Update Redux store
      dispatch(setCurrentStore({ ...currentStore, settings: { ...currentStore.settings, logoUrl: imageUrl } } as Store));
      toast.success('Logo uploaded successfully');
    } catch {
      toast.error('Failed to upload logo');
    } finally {
      setUploadingLogo(false);
    }
  };

  /**
   * Theme is saved on click rather than waiting for "Save Changes".
   *
   * It is a single enum with a live preview, so a staged edit adds a step for no
   * benefit. Sent through the existing settings endpoint on its own — the rest
   * of `form` is deliberately NOT included, so an in-progress edit to another
   * field cannot be written by accident when the merchant tries a theme.
   */
  const handleSelectTheme = async (theme: StoreTheme) => {
    if (!currentStore || savingTheme) return;
    const previous = resolveTheme(currentStore.theme);
    setSavingTheme(theme);

    // Optimistic: the storefront preview and picker update instantly.
    dispatch(setCurrentStore({ ...currentStore, theme } as Store));

    try {
      const res = await storesApi.updateSettings(currentStore._id, { theme });
      dispatch(setCurrentStore(res.data.data));
      toast.success(`${getThemeMeta(theme).name} theme applied`);
    } catch {
      // Roll back so the picker never shows a selection the server rejected.
      dispatch(setCurrentStore({ ...currentStore, theme: previous } as Store));
      // Error toast already fired by the axios interceptor.
    } finally {
      setSavingTheme(null);
    }
  };

  /**
   * Tax pricing mode.
   *
   * Sent on its own — like the theme picker above and for a stronger reason:
   * this reinterprets every price in the catalogue, so it must never ride along
   * with an unrelated in-progress edit. Confirmed first because the merchant
   * cannot see the consequence from this screen; the same £100 product becomes
   * either £100 + tax or £100 including tax.
   */
  const handleTogglePricesIncludeTax = async (next: boolean) => {
    if (!currentStore || savingTaxMode) return;

    const message = next
      ? 'Treat all catalogue prices as ALREADY INCLUDING tax?\n\nCustomers will pay the listed price and the invoice will break out the tax component.'
      : 'Treat all catalogue prices as EXCLUDING tax?\n\nTax will be added at checkout, so customers pay more than the listed price.';
    if (!window.confirm(message)) return;

    setSavingTaxMode(true);
    const previous = currentStore.pricesIncludeTax ?? false;
    dispatch(setCurrentStore({ ...currentStore, pricesIncludeTax: next } as Store));

    try {
      const res = await storesApi.updateSettings(currentStore._id, { pricesIncludeTax: next });
      dispatch(setCurrentStore(res.data.data));
      toast.success(next ? 'Prices now include tax' : 'Prices now exclude tax');
    } catch {
      dispatch(setCurrentStore({ ...currentStore, pricesIncludeTax: previous } as Store));
    } finally {
      setSavingTaxMode(false);
    }
  };

  const handleSave = async () => {
    if (!currentStore) return;
    setSaving(true);
    try {
      const res = await storesApi.updateSettings(currentStore._id, form);
      dispatch(setCurrentStore(res.data.data));
      toast.success('Settings saved successfully');
    } catch {
      // toast fired by interceptor
    } finally {
      setSaving(false);
    }
  };

  if (storeLoading && !currentStore) {
    return (
      <div className="p-6">
        <CardGridSkeleton
          count={3}
          lines={0}
          padding="p-6"
          footer
          className="space-y-4"
          label="Loading store settings…"
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Store Settings</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Customize how your store appears to customers.
        </p>
      </div>

      <div className="space-y-6">
        {/* ── Appearance ───────────────────────────────────────────────────
            Placed above General because it is the change with the largest
            visible effect, and the one a merchant most often comes here for. */}
        <Section
          title="Appearance"
          description="Choose how your storefront looks. Applies instantly — your products, prices, orders and checkout are never affected."
        >
          <ThemePicker
            value={resolveTheme(currentStore?.theme)}
            onSelect={handleSelectTheme}
            savingTheme={savingTheme}
            disabled={!currentStore}
          />
        </Section>

        {/* ── Tax pricing ──────────────────────────────────────────────────
            Not part of the batched "Save" below: this reinterprets the whole
            catalogue, so it writes on toggle, behind a confirm. */}
        <Section
          title="Tax"
          description="How your listed prices relate to tax. This changes what customers are charged, so choose it before you start selling."
        >
          <div className="space-y-3">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 p-4 transition-colors hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600">
              <input
                type="checkbox"
                checked={currentStore?.pricesIncludeTax ?? false}
                disabled={!currentStore || savingTaxMode}
                onChange={e => handleTogglePricesIncludeTax(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300"
              />
              <span className="text-sm">
                <span className="block font-medium text-gray-900 dark:text-white">
                  My prices already include tax
                </span>
                <span className="mt-0.5 block text-gray-500 dark:text-gray-400">
                  {currentStore?.pricesIncludeTax
                    ? 'A £100 product is charged at £100, and the invoice shows the tax contained in it. Standard in the UK, EU and MENA.'
                    : 'A £100 product is charged at £100 plus tax, so the customer pays more than the listed price. Standard in the US.'}
                </span>
              </span>
            </label>

            <p className="text-xs text-gray-400">
              Rates themselves are configured under{' '}
              <Link to="/admin/tax" className="font-medium text-primary-600 hover:underline dark:text-primary-400">
                Tax
              </Link>
              . With no rates set up, no tax is charged.
            </p>
          </div>
        </Section>

        {/* ── General ─────────────────────────────────────────────────────── */}
        <Section title="General" description="Basic store information shown on the storefront.">
          <Field label="Store Name" htmlFor="settings-store-name" hint="Displayed in the navbar and page titles">
            <input
              id="settings-store-name"
              className="input"
              value={form.name}
              onChange={e => set('name')(e.target.value)}
              placeholder="My Awesome Store"
              autoComplete="organization"
              aria-describedby="settings-store-name-hint"
            />
          </Field>

          <Field label="Store Slug" htmlFor="settings-store-slug" hint="Your store's URL identifier (read-only)">
            <div className="flex items-center gap-2">
              <span className="text-gray-400 text-sm shrink-0" aria-hidden="true">shophub.com/</span>
              <input
                id="settings-store-slug"
                className="input flex-1 bg-gray-50 dark:bg-gray-800 cursor-not-allowed"
                value={currentStore?.slug ?? ''}
                aria-describedby="settings-store-slug-hint"
                readOnly
                disabled
              />
            </div>
          </Field>

          <Field label="Plan" hint="Your current subscription">
            <span className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-full ${
              currentStore?.subscriptionPlan === 'pro' || currentStore?.subscriptionPlan === 'enterprise'
                ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
            }`}>
              {currentStore?.subscriptionPlan === 'free' ? '🆓' : '⭐'} {currentStore?.subscriptionPlan ?? 'free'}
            </span>
          </Field>
        </Section>

        {/* ── Logo ────────────────────────────────────────────────────────── */}
        <Section title="Store Logo" description="Shown in the navbar and on receipts. Recommended: 200×200px PNG.">
          <div className="flex items-start gap-6">
            {/* Preview */}
            <div className="shrink-0">
              <div className="w-24 h-24 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 overflow-hidden flex items-center justify-center bg-gray-50 dark:bg-gray-800">
                {logoPreview ? (
                  <img src={logoPreview} alt="Store logo" className="w-full h-full object-contain" />
                ) : (
                  <span className="text-3xl">🏪</span>
                )}
              </div>
            </div>

            {/* Controls */}
            <div className="flex-1 space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleLogoSelect}
                className="hidden"
              />
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="btn-secondary text-sm"
                >
                  📁 Choose Image
                </button>
                {logoFile && (
                  <button
                    type="button"
                    onClick={handleUploadLogo}
                    disabled={uploadingLogo}
                    className="btn-primary text-sm disabled:opacity-50"
                  >
                    {uploadingLogo ? (
                      <span className="flex items-center gap-1.5">
                        <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Uploading…
                      </span>
                    ) : '☁️ Upload Logo'}
                  </button>
                )}
                {logoPreview && !logoFile && (
                  <button
                    type="button"
                    onClick={() => { setLogoPreview(null); setLogoFile(null); set('contactEmail')(''); }}
                    className="text-sm text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                )}
              </div>
              {logoFile && (
                <p className="text-xs text-gray-500">
                  Selected: <strong>{logoFile.name}</strong> ({(logoFile.size / 1024).toFixed(0)} KB) — click Upload to save
                </p>
              )}
              <p className="text-xs text-gray-400">PNG, JPG, WebP · Max 5MB · Auto-optimized via Cloudinary</p>
            </div>
          </div>
        </Section>

        {/* ── Contact ─────────────────────────────────────────────────────── */}
        <Section title="Contact Information" description="Displayed in the storefront footer and order emails.">
          <Field label="Contact Email" htmlFor="settings-contact-email">
            <input
              id="settings-contact-email"
              type="email"
              className="input"
              value={form.contactEmail}
              onChange={e => set('contactEmail')(e.target.value)}
              placeholder="support@mystore.com"
              autoComplete="email"
            />
          </Field>
          <Field label="Phone Number" htmlFor="settings-phone">
            <input
              id="settings-phone"
              type="tel"
              className="input"
              value={form.contactPhone}
              onChange={e => set('contactPhone')(e.target.value)}
              placeholder="+1 (555) 000-0000"
              autoComplete="tel"
            />
          </Field>
        </Section>

        {/* ── Social Media ─────────────────────────────────────────────────── */}
        <Section title="Social Media" description="Links shown in the storefront footer.">
          <div className="space-y-3">
            <SocialInput icon="📘" network="Facebook" placeholder="https://facebook.com/yourpage" value={form.facebook} onChange={set('facebook')} />
            <SocialInput icon="📸" network="Instagram" placeholder="https://instagram.com/yourhandle" value={form.instagram} onChange={set('instagram')} />
            <SocialInput icon="🐦" network="Twitter" placeholder="https://twitter.com/yourhandle" value={form.twitter} onChange={set('twitter')} />
            <SocialInput icon="🎵" network="TikTok" placeholder="https://tiktok.com/@yourhandle" value={form.tiktok} onChange={set('tiktok')} />
            <SocialInput icon="▶️" network="YouTube" placeholder="https://youtube.com/@yourchannel" value={form.youtube} onChange={set('youtube')} />
          </div>
        </Section>

        {/* ── Save button ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-gray-400">Changes are applied immediately after saving.</p>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary px-8 disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving…
              </>
            ) : '💾 Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
