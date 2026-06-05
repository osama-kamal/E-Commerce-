import { useEffect, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../hooks/useAppDispatch';
import { fetchCurrentStore, setCurrentStore } from '../../store/storeSlice';
import { storesApi } from '../../api/stores';
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid sm:grid-cols-3 gap-3 items-start py-4 border-b dark:border-gray-800 last:border-0">
      <div>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</p>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <div className="sm:col-span-2">{children}</div>
    </div>
  );
}

// ── Social input with icon ────────────────────────────────────────────────────

function SocialInput({ icon, placeholder, value, onChange }: {
  icon: string; placeholder: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xl w-7 shrink-0">{icon}</span>
      <input
        type="url"
        className="input flex-1"
        placeholder={placeholder}
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
      <div className="p-6 space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="card p-6 animate-pulse">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4 mb-4" />
            <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded" />
          </div>
        ))}
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
        {/* ── General ─────────────────────────────────────────────────────── */}
        <Section title="General" description="Basic store information shown on the storefront.">
          <Field label="Store Name" hint="Displayed in the navbar and page titles">
            <input
              className="input"
              value={form.name}
              onChange={e => set('name')(e.target.value)}
              placeholder="My Awesome Store"
            />
          </Field>

          <Field label="Store Slug" hint="Your store's URL identifier (read-only)">
            <div className="flex items-center gap-2">
              <span className="text-gray-400 text-sm shrink-0">shophub.com/</span>
              <input
                className="input flex-1 bg-gray-50 dark:bg-gray-800 cursor-not-allowed"
                value={currentStore?.slug ?? ''}
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
          <Field label="Contact Email">
            <input
              type="email"
              className="input"
              value={form.contactEmail}
              onChange={e => set('contactEmail')(e.target.value)}
              placeholder="support@mystore.com"
            />
          </Field>
          <Field label="Phone Number">
            <input
              type="tel"
              className="input"
              value={form.contactPhone}
              onChange={e => set('contactPhone')(e.target.value)}
              placeholder="+1 (555) 000-0000"
            />
          </Field>
        </Section>

        {/* ── Social Media ─────────────────────────────────────────────────── */}
        <Section title="Social Media" description="Links shown in the storefront footer.">
          <div className="space-y-3">
            <SocialInput icon="📘" placeholder="https://facebook.com/yourpage" value={form.facebook} onChange={set('facebook')} />
            <SocialInput icon="📸" placeholder="https://instagram.com/yourhandle" value={form.instagram} onChange={set('instagram')} />
            <SocialInput icon="🐦" placeholder="https://twitter.com/yourhandle" value={form.twitter} onChange={set('twitter')} />
            <SocialInput icon="🎵" placeholder="https://tiktok.com/@yourhandle" value={form.tiktok} onChange={set('tiktok')} />
            <SocialInput icon="▶️" placeholder="https://youtube.com/@yourchannel" value={form.youtube} onChange={set('youtube')} />
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
