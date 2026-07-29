import { useEffect, useState, FormEvent } from 'react';
import { AnimatePresence } from 'framer-motion';
import { categoriesApi } from '../../api/categories';
import { TableRowsSkeleton, TableSkeleton } from '../../components/Skeleton';
import { Category } from '../../types';
import Modal from '../../components/Modal';
import toast from 'react-hot-toast';

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

// ── Category Form Modal ───────────────────────────────────────────────────────

interface FormState {
  name: string;
  slug: string;
  parentId: string;
}

function CategoryModal({
  category,
  categories,
  onClose,
  onSaved,
}: {
  category: Category | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(category);
  const [form, setForm] = useState<FormState>({
    name: category?.name ?? '',
    slug: category?.slug ?? '',
    parentId: category?.parentId ?? '',
  });
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<FormState>>({});

  // Auto-generate slug from name unless user has manually edited it
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    setForm(f => ({
      ...f,
      name,
      slug: slugManuallyEdited ? f.slug : slugify(name),
    }));
  };

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSlugManuallyEdited(true);
    setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }));
  };

  const validate = (): boolean => {
    const e: Partial<FormState> = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (!form.slug.trim()) e.slug = 'Slug is required';
    else if (!/^[a-z0-9-]+$/.test(form.slug)) e.slug = 'Only lowercase letters, numbers, and hyphens';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        parentId: form.parentId || undefined,
      };
      if (isEdit && category) {
        await categoriesApi.update(category._id, payload);
        toast.success('Category updated');
      } else {
        await categoriesApi.create(payload);
        toast.success('Category created');
      }
      onSaved();
      onClose();
    } catch {
      // toast fired by interceptor
    } finally {
      setSaving(false);
    }
  };

  // Only root categories can be parents (prevent deep nesting)
  const rootCategories = categories.filter(c => c.level === 0 && c._id !== category?._id);

  return (
    <Modal
      onClose={onClose}
      labelledBy="category-modal-title"
      panelClassName="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md"
    >
      <>
        <div className="flex items-center justify-between p-6 border-b dark:border-gray-800">
          <h2 id="category-modal-title" className="text-lg font-bold text-gray-900 dark:text-white">
            {isEdit ? 'Edit Category' : 'New Category'}
          </h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4" noValidate>
          {/* Name */}
          <div>
            <label htmlFor="category-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Category Name
            </label>
            <input
              id="category-name"
              className="input"
              value={form.name}
              onChange={handleNameChange}
              placeholder="e.g. Men's Clothing"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? 'category-name-error' : undefined}
              autoFocus
            />
            {errors.name && <p id="category-name-error" role="alert" className="text-red-500 text-xs mt-1">{errors.name}</p>}
          </div>

          {/* Slug */}
          <div>
            <label htmlFor="category-slug" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Slug <span className="text-gray-400 font-normal">(URL-friendly identifier)</span>
            </label>
            <div className="flex items-center gap-2">
              <span className="text-gray-400 text-sm shrink-0" aria-hidden="true">/categories/</span>
              <input
                id="category-slug"
                className="input flex-1"
                value={form.slug}
                onChange={handleSlugChange}
                placeholder="mens-clothing"
                aria-invalid={errors.slug ? true : undefined}
                aria-describedby={errors.slug ? 'category-slug-error' : undefined}
              />
            </div>
            {errors.slug && <p id="category-slug-error" role="alert" className="text-red-500 text-xs mt-1">{errors.slug}</p>}
          </div>

          {/* Parent category */}
          <div>
            <label htmlFor="category-parent" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Parent Category <span className="text-gray-400 font-normal">(optional — leave empty for root)</span>
            </label>
            <select
              id="category-parent"
              className="input"
              value={form.parentId}
              onChange={e => setForm(f => ({ ...f, parentId: e.target.value }))}
            >
              <option value="">— Root category —</option>
              {rootCategories.map(c => (
                <option key={c._id} value={c._id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Level preview */}
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
            {form.parentId
              ? <span>📂 This will be a <strong>sub-category</strong> under the selected parent</span>
              : <span>📁 This will be a <strong>root category</strong></span>
            }
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Category'}
            </button>
          </div>
        </form>
      </>
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalCategory, setModalCategory] = useState<Category | null | undefined>(undefined);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const res = await categoriesApi.list();
      setCategories(res.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCategories(); }, []);

  const handleDelete = async (cat: Category) => {
    const hasChildren = categories.some(c => c.parentId === cat._id);
    if (hasChildren) {
      toast.error('Delete sub-categories first before deleting this parent');
      return;
    }
    if (!confirm(`Delete "${cat.name}"? This cannot be undone.`)) return;
    setDeletingId(cat._id);
    try {
      await categoriesApi.delete(cat._id);
      toast.success('Category deleted');
      fetchCategories();
    } catch {
      // interceptor handles toast
    } finally {
      setDeletingId(null);
    }
  };

  const isModalOpen = modalCategory !== undefined;

  // Build tree: roots first, then their children
  const roots = categories.filter(c => c.level === 0).sort((a, b) => a.name.localeCompare(b.name));
  const childrenOf = (parentId: string) =>
    categories.filter(c => c.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Categories</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {categories.length} total · {roots.length} root · {categories.filter(c => c.level === 1).length} sub-categories
          </p>
        </div>
        <button
          onClick={() => setModalCategory(null)}
          className="btn-primary flex items-center gap-2"
        >
          <span className="text-lg leading-none">+</span> New Category
        </button>
      </div>

      {/* Empty state */}
      {!loading && categories.length === 0 && (
        <div className="card p-12 text-center">
          <div className="text-5xl mb-4">📂</div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No categories yet</h3>
          <p className="text-gray-500 dark:text-gray-400 mb-6 text-sm">
            Create your first category to start organizing products.
          </p>
          <button onClick={() => setModalCategory(null)} className="btn-primary">
            Create First Category
          </button>
        </div>
      )}

      {/* Category tree */}
      {!loading && categories.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700">
              <tr>
                {['Category', 'Slug', 'Level', 'Sub-categories', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-gray-500 dark:text-gray-400 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading
                ? <TableRowsSkeleton rows={4} columns={5} />
                : roots.map(root => {
                    const children = childrenOf(root._id);
                    return [
                      // Root row
                      <tr key={root._id} className="border-b dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">📁</span>
                            <span className="font-semibold text-gray-900 dark:text-white">{root.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <code className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-gray-600 dark:text-gray-400">
                            {root.slug}
                          </code>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-medium px-2 py-1 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
                            Root
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                          {children.length > 0 ? `${children.length} sub-categor${children.length === 1 ? 'y' : 'ies'}` : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setModalCategory(root)}
                              className="text-xs px-3 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                            >
                              ✏️ Edit
                            </button>
                            <button
                              onClick={() => handleDelete(root)}
                              disabled={deletingId === root._id}
                              className="text-xs px-3 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors disabled:opacity-50"
                            >
                              {deletingId === root._id ? '…' : '🗑️ Delete'}
                            </button>
                          </div>
                        </td>
                      </tr>,
                      // Child rows
                      ...children.map(child => (
                        <tr key={child._id} className="border-b dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 bg-gray-50/50 dark:bg-gray-800/20">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2 pl-6">
                              <span className="text-gray-300 dark:text-gray-600 text-xs">└─</span>
                              <span className="text-lg">📂</span>
                              <span className="text-gray-800 dark:text-gray-200">{child.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <code className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-gray-600 dark:text-gray-400">
                              {child.slug}
                            </code>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs font-medium px-2 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                              Sub
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-400 dark:text-gray-500">—</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setModalCategory(child)}
                                className="text-xs px-3 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                              >
                                ✏️ Edit
                              </button>
                              <button
                                onClick={() => handleDelete(child)}
                                disabled={deletingId === child._id}
                                className="text-xs px-3 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors disabled:opacity-50"
                              >
                                {deletingId === child._id ? '…' : '🗑️ Delete'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )),
                    ];
                  })
              }
            </tbody>
          </table>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="card overflow-hidden">
          <TableSkeleton
            headers={['Category', 'Slug', 'Level', 'Sub-categories', 'Actions']}
            rows={5}
            label="Loading categories…"
            headerClassName="text-left px-4 py-3 text-gray-500 dark:text-gray-400 font-medium"
          />
        </div>
      )}

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <CategoryModal
            category={modalCategory ?? null}
            categories={categories}
            onClose={() => setModalCategory(undefined)}
            onSaved={fetchCategories}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
