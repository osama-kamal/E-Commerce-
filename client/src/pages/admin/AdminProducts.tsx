import { useEffect, useState, FormEvent, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { productsApi } from '../../api/products';
import { categoriesApi } from '../../api/categories';
import { adminApi } from '../../api/admin';
import { useAppSelector } from '../../hooks/useAppDispatch';
import Modal from '../../components/Modal';
import { TableRowsSkeleton } from '../../components/Skeleton';
import { Product, Category } from '../../types';
import toast from 'react-hot-toast';
import axios from 'axios';

// ── Plan limit constants (mirrors backend planLimits.ts) ─────────────────────

const PLAN_LIMITS: Record<string, number> = {
  free: 15,
  starter: 500,
  pro: -1,
  enterprise: -1,
};

function getProductLimit(plan: string): number {
  return PLAN_LIMITS[plan] ?? 15;
}

// ── Plan Limit Upgrade Modal ──────────────────────────────────────────────────

function PlanLimitModal({ plan, limit, onClose }: { plan: string; limit: number; onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <Modal
      onClose={onClose}
      labelledBy="plan-limit-title"
      describedBy="plan-limit-desc"
      panelClassName="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6 text-center"
    >
      <div className="text-5xl mb-4" aria-hidden="true">🚀</div>
      <h2 id="plan-limit-title" className="text-xl font-bold text-gray-900 dark:text-white mb-2">
        Product Limit Reached
      </h2>
      <p id="plan-limit-desc" className="text-gray-500 dark:text-gray-400 text-sm mb-4">
        Your <strong className="text-gray-700 dark:text-gray-300 capitalize">{plan}</strong> plan
        allows up to <strong>{limit}</strong> products.
        Upgrade to add unlimited products.
      </p>
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 mb-5 text-sm text-amber-800 dark:text-amber-300">
        💡 You currently have <strong>{limit}</strong> active products — the maximum for your plan.
      </div>
      <div className="flex gap-3">
        <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
        <button
          onClick={() => { onClose(); navigate('/admin/pricing'); }}
          className="btn-primary flex-1 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500"
        >
          ⭐ Upgrade Plan
        </button>
      </div>
    </Modal>
  );
}

// ── Image Upload Modal ────────────────────────────────────────────────────────

function ImageUploadModal({
  product,
  onClose,
  onUploaded,
}: {
  product: Product;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [deletingUrl, setDeletingUrl] = useState<string | null>(null);
  const [currentImages, setCurrentImages] = useState<string[]>(product.images || []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image must be less than 10MB');
      return;
    }

    setSelectedFile(file);
    
    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', selectedFile);

      const token = localStorage.getItem('accessToken') ?? '';
      const storeId = localStorage.getItem('currentStoreId') ?? '';

      const response = await axios.post(`/api/v1/products/${product._id}/images`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          Authorization: `Bearer ${token}`,
          'X-Store-ID': storeId,
        },
      });

      toast.success('Image uploaded successfully! ☁️', { duration: 3000 });
      const updatedProduct = response.data.data.product;
      if (updatedProduct?.images) setCurrentImages(updatedProduct.images);
      setSelectedFile(null);
      setPreview(null);
      onUploaded();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to upload image');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteImage = async (imageUrl: string) => {
    if (!confirm('Delete this image?')) return;
    setDeletingUrl(imageUrl);
    try {
      const token = localStorage.getItem('accessToken') ?? '';
      const storeId = localStorage.getItem('currentStoreId') ?? '';
      await axios.delete(`/api/v1/products/${product._id}/images`, {
        data: { imageUrl },
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Store-ID': storeId,
        },
      });
      setCurrentImages(prev => prev.filter(img => img !== imageUrl));
      toast.success('Image deleted!');
      onUploaded();
    } catch {
      toast.error('Failed to delete image');
    } finally {
      setDeletingUrl(null);
    }
  };

  return (
    <Modal
      onClose={onClose}
      labelledBy="image-upload-title"
      describedBy="image-upload-product"
      panelClassName="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md"
    >
      <>
        <div className="flex items-center justify-between p-6 border-b dark:border-gray-800">
          <div>
            <h2 id="image-upload-title" className="text-lg font-bold text-gray-900 dark:text-white">Upload Product Image</h2>
            <p id="image-upload-product" className="text-sm text-gray-500 dark:text-gray-400 mt-1">{product.name}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">✕</button>
        </div>

        <div className="p-6 space-y-4">
          {/* Current Images */}
          {currentImages.length > 0 && (
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Current Images ({currentImages.length})</p>
              <div className="grid grid-cols-3 gap-2">
                {currentImages.map((img, i) => (
                  <div key={i} className="relative group rounded-lg overflow-hidden border dark:border-gray-700">
                    <img src={img} alt={`Product ${i + 1}`} className="w-full h-20 object-cover" />
                    <button
                      onClick={() => handleDeleteImage(img)}
                      disabled={deletingUrl === img}
                      className="absolute inset-0 bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs font-medium"
                    >
                      {deletingUrl === img ? '...' : '🗑️ Delete'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* File Input */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />
            
            {!preview ? (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-8 hover:border-primary-500 dark:hover:border-primary-500 transition-colors"
              >
                <div className="text-center">
                  <div className="text-4xl mb-2">📸</div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Click to select image</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">JPEG, PNG, WebP, GIF (max 10MB)</p>
                </div>
              </button>
            ) : (
              <div className="space-y-3">
                <div className="relative rounded-xl overflow-hidden border dark:border-gray-700">
                  <img src={preview} alt="Preview" className="w-full h-64 object-cover" />
                  <button
                    onClick={() => {
                      setSelectedFile(null);
                      setPreview(null);
                    }}
                    className="btn btn-icon btn-danger absolute top-2 right-2 w-8 h-8"
                  >
                    ✕
                  </button>
                </div>
                
                {selectedFile && (
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    <p><strong>File:</strong> {selectedFile.name}</p>
                    <p><strong>Size:</strong> {(selectedFile.size / 1024).toFixed(0)} KB</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
            <p className="text-xs text-blue-800 dark:text-blue-300">
              <strong>✨ Auto-Optimization:</strong> Images will be automatically compressed, resized to 1200x1200px, and converted to WebP format for optimal performance.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button
              onClick={handleUpload}
              disabled={!selectedFile || uploading}
              className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? '⏳ Uploading...' : '📤 Upload Image'}
            </button>
          </div>
        </div>
      </>
    </Modal>
  );
}

// ── Product Form Modal ────────────────────────────────────────────────────────

interface FormState {
  name: string;
  description: string;
  price: string;
  stock: string;
  categoryId: string;
  sizes: string;
}

const EMPTY_FORM: FormState = { name: '', description: '', price: '', stock: '0', categoryId: '', sizes: '' };

function ProductModal({
  product,
  categories,
  onClose,
  onSaved,
}: {
  product: Product | null; // null = create mode
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(product);
  const [form, setForm] = useState<FormState>(
    product
      ? {
          name: product.name,
          description: product.description,
          price: product.price.toString(),
          stock: product.stock.toString(),
          categoryId: product.categoryId,
          sizes: (product.sizes || []).join(', '),
        }
      : EMPTY_FORM
  );
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<FormState>>({});

  const validate = (): boolean => {
    const e: Partial<FormState> = {};
    if (!form.name.trim())        e.name = 'Name is required';
    if (!form.description.trim()) e.description = 'Description is required';
    if (!form.price || isNaN(Number(form.price)) || Number(form.price) < 0)
      e.price = 'Valid price required';
    if (!form.stock || isNaN(Number(form.stock)) || Number(form.stock) < 0)
      e.stock = 'Valid stock required';
    if (!form.categoryId) e.categoryId = 'Category is required';
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
        description: form.description.trim(),
        price: Number(form.price),
        stock: Number(form.stock),
        categoryId: form.categoryId,
        sizes: form.sizes ? form.sizes.split(',').map(s => s.trim()).filter(Boolean) : [],
      };
      if (isEdit && product) {
        await productsApi.update(product._id, payload);
        toast.success('Product updated');
      } else {
        await productsApi.create(payload);
        toast.success('Product created');
      }
      onSaved();
      onClose();
    } catch {
      // toast fired by interceptor
    } finally {
      setSaving(false);
    }
  };

  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }));

  // Show all categories (both root and sub) so new stores with only root categories can still pick one
  const allCategories = [...categories].sort((a, b) => {
    // Group by root first, then sub
    if (a.level !== b.level) return a.level - b.level;
    return a.name.localeCompare(b.name);
  });

  return (
    <Modal
      onClose={onClose}
      labelledBy="product-modal-title"
      panelClassName="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
    >
      <>
        <div className="flex items-center justify-between p-6 border-b dark:border-gray-800">
          <h2 id="product-modal-title" className="text-lg font-bold text-gray-900 dark:text-white">
            {isEdit ? 'Edit Product' : 'Add New Product'}
          </h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4" noValidate>
          {/* Name */}
          <div>
            <label htmlFor="product-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Product Name</label>
            <input id="product-name" className="input" value={form.name} onChange={set('name')} placeholder="e.g. iPhone 15 Pro" />
            {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
          </div>

          {/* Description */}
          <div>
            <label htmlFor="product-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
            <textarea id="product-description" className="input" rows={3} value={form.description} onChange={set('description')} placeholder="Product description…" />
            {errors.description && <p className="text-red-500 text-xs mt-1">{errors.description}</p>}
          </div>

          {/* Price + Stock */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="product-price" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Price ($)</label>
              <input id="product-price" type="number" min="0" step="0.01" className="input" value={form.price} onChange={set('price')} placeholder="0.00" />
              {errors.price && <p className="text-red-500 text-xs mt-1">{errors.price}</p>}
            </div>
            <div>
              <label htmlFor="product-stock" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Stock</label>
              <input id="product-stock" type="number" min="0" step="1" className="input" value={form.stock} onChange={set('stock')} placeholder="0" />
              {errors.stock && <p className="text-red-500 text-xs mt-1">{errors.stock}</p>}
            </div>
          </div>

          {/* Category */}
          <div>
            <label htmlFor="product-category" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category</label>
            {allCategories.length === 0 ? (
              <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300 flex items-center justify-between gap-3">
                <span>⚠️ No categories yet.</span>
                <a
                  href="/admin/categories"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold underline hover:no-underline shrink-0"
                >
                  Create one →
                </a>
              </div>
            ) : (
              <select id="product-category" className="input" value={form.categoryId} onChange={set('categoryId')}>
                <option value="">Select a category…</option>
                {allCategories.map(c => (
                  <option key={c._id} value={c._id}>
                    {c.level === 1 ? `  └─ ${c.name}` : c.name}
                  </option>
                ))}
              </select>
            )}
            {errors.categoryId && <p className="text-red-500 text-xs mt-1">{errors.categoryId}</p>}
          </div>

          {/* Sizes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Sizes <span className="text-gray-400 font-normal">(optional, comma-separated)</span>
            </label>
            <input
              className="input"
              value={form.sizes}
              onChange={set('sizes')}
              placeholder="e.g. XS, S, M, L, XL, XXL"
            />
            <p className="text-xs text-gray-400 mt-1">Leave empty if product has no sizes</p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Product'}
            </button>
          </div>
        </form>
      </>
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminProducts() {
  const currentStore = useAppSelector(s => s.currentStore.current);
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [modalProduct, setModalProduct] = useState<Product | null | undefined>(undefined);
  const [uploadProduct, setUploadProduct] = useState<Product | null>(null);

  // Low stock state
  const [lowStockProducts, setLowStockProducts] = useState<{ _id: string; name: string; stock: number; images: string[] }[]>([]);
  const LOW_STOCK_THRESHOLD = 10;

  // Bulk selection state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState('');
  const [bulkUpdates, setBulkUpdates] = useState({ price: '', stock: '', discount: '' });
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const res = await productsApi.list({ page, limit: 20 });
      setProducts(res.data.data.data);
      setTotal(res.data.data.total);
      setTotalPages(res.data.data.totalPages);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchProducts(); }, [page]);
  useEffect(() => {
    categoriesApi.list().then(res => setCategories(res.data.data));
  }, []);
  useEffect(() => {
    adminApi.getLowStock(LOW_STOCK_THRESHOLD)
      .then(res => setLowStockProducts(res.data.data.products))
      .catch(() => {});
  }, [products]); // re-fetch when products change

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this product?')) return;
    await productsApi.delete(id);
    toast.success('Product deleted');
    fetchProducts();
  };

  // ── Bulk helpers ──────────────────────────────────────────────────────────

  const allSelected = products.length > 0 && products.every(p => selected.has(p._id));
  const someSelected = selected.size > 0;

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(products.map(p => p._id)));
    }
  };

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} products? This cannot be undone.`)) return;
    setBulkLoading(true);
    try {
      const res = await productsApi.bulkDelete(Array.from(selected));
      toast.success((res.data as any).data?.message || `${selected.size} products deleted`);
      setSelected(new Set());
      fetchProducts();
    } catch {
      // interceptor handles toast
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkUpdate = async () => {
    const updates: Record<string, number> = {};
    if (bulkUpdates.price !== '') updates.price = Number(bulkUpdates.price);
    if (bulkUpdates.stock !== '') updates.stock = Number(bulkUpdates.stock);
    if (bulkUpdates.discount !== '') updates.discount = Number(bulkUpdates.discount);

    if (Object.keys(updates).length === 0) {
      toast.error('Enter at least one field to update');
      return;
    }

    setBulkLoading(true);
    try {
      const res = await productsApi.bulkUpdate(Array.from(selected), updates);
      toast.success((res.data as any).data?.message || `${selected.size} products updated`);
      setSelected(new Set());
      setShowBulkEdit(false);
      setBulkUpdates({ price: '', stock: '', discount: '' });
      fetchProducts();
    } catch {
      // interceptor handles toast
    } finally {
      setBulkLoading(false);
    }
  };

  const isModalOpen = modalProduct !== undefined;

  // ── Plan limit check ──────────────────────────────────────────────────────
  const plan = currentStore?.subscriptionPlan ?? 'free';
  const productLimit = getProductLimit(plan);
  const isAtLimit = productLimit !== -1 && total >= productLimit;

  const handleAddProductClick = () => {
    if (isAtLimit) {
      setShowLimitModal(true);
    } else {
      setModalProduct(null);
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Products</h1>
          {/* Plan usage indicator */}
          {productLimit !== -1 && (
            <p className={`text-xs mt-1 ${isAtLimit ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>
              {total} / {productLimit} products used
              {isAtLimit && ' — limit reached'}
            </p>
          )}
        </div>
        <button
          onClick={handleAddProductClick}
          className={`flex items-center gap-2 ${isAtLimit ? 'btn-secondary border-amber-400 text-amber-600 dark:text-amber-400' : 'btn-primary'}`}
        >
          {isAtLimit ? '🔒 Limit Reached — Upgrade' : <><span className="text-lg leading-none">+</span> Add Product</>}
        </button>
      </div>

      {/* ── Last Chance / Low Stock Section ── */}
      {lowStockProducts.length > 0 && (
        <div className="mb-6 border-2 border-orange-300 dark:border-orange-700 rounded-xl overflow-hidden">
          <div className="bg-orange-50 dark:bg-orange-900/20 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">⚠️</span>
              <h2 className="font-bold text-orange-800 dark:text-orange-300 text-base">
                Last Chance — {lowStockProducts.length} product{lowStockProducts.length !== 1 ? 's' : ''} with ≤{LOW_STOCK_THRESHOLD} units left
              </h2>
            </div>
            <span className="text-xs text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/40 px-2 py-1 rounded-full font-medium">
              Restock needed
            </span>
          </div>
          <div className="bg-white dark:bg-gray-800 divide-y divide-orange-100 dark:divide-orange-900/30">
            {lowStockProducts.map(p => (
              <div key={p._id} className="flex items-center gap-4 px-4 py-3 hover:bg-orange-50 dark:hover:bg-orange-900/10 transition-colors">
                {/* Product image */}
                <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700 shrink-0">
                  {p.images[0] ? (
                    <img src={p.images[0]} alt={p.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-lg">📦</div>
                  )}
                </div>
                {/* Name */}
                <span className="flex-1 text-sm font-medium text-gray-900 dark:text-white truncate">{p.name}</span>
                {/* Stock badge */}
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                  p.stock === 0
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
                    : 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400'
                }`}>
                  {p.stock === 0 ? 'Out of stock' : `${p.stock} left`}
                </span>
                {/* Edit button */}
                <button
                  onClick={() => {
                    const newStock = window.prompt(`Enter new stock for "${p.name}":`, String(p.stock));
                    if (newStock === null) return;
                    const qty = parseInt(newStock, 10);
                    if (isNaN(qty) || qty < 0) { alert('Invalid stock value'); return; }
                    import('../../api/products').then(({ productsApi }) => {
                      productsApi.update(p._id, { stock: qty })
                        .then(() => {
                          adminApi.getLowStock(LOW_STOCK_THRESHOLD)
                            .then(res => setLowStockProducts(res.data.data.products))
                            .catch(() => {});
                          fetchProducts();
                        })
                        .catch(() => alert('Failed to update stock'));
                    });
                  }}
                  className="text-xs px-3 py-1 rounded-lg bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400 hover:bg-primary-100 transition-colors font-medium shrink-0"
                >
                  Update Stock
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bulk Action Bar */}
      <AnimatePresence>
        {someSelected && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mb-4 p-3 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-xl flex flex-wrap items-center gap-3"
          >
            <span className="text-sm font-medium text-primary-700 dark:text-primary-300">
              {selected.size} product{selected.size > 1 ? 's' : ''} selected
            </span>

            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <button
                onClick={() => { setShowBulkEdit(true); setBulkAction('edit'); }}
                className="btn-secondary text-sm py-1.5 px-3"
              >
                ✏️ Edit Selected
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={bulkLoading}
                className="btn btn-danger py-1.5 px-3 text-sm"
              >
                {bulkLoading ? '⏳ Deleting...' : '🗑️ Delete Selected'}
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="text-gray-500 hover:text-gray-700 text-sm"
              >
                ✕ Clear
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bulk Edit Panel */}
      <AnimatePresence>
        {showBulkEdit && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-4 p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl"
          >
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
              Bulk Edit — {selected.size} products (leave blank to skip)
            </h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">New Price ($)</label>
                <input
                  type="number" min="0" step="0.01"
                  className="input text-sm"
                  placeholder="e.g. 29.99"
                  value={bulkUpdates.price}
                  onChange={e => setBulkUpdates(p => ({ ...p, price: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">New Stock</label>
                <input
                  type="number" min="0"
                  className="input text-sm"
                  placeholder="e.g. 100"
                  value={bulkUpdates.stock}
                  onChange={e => setBulkUpdates(p => ({ ...p, stock: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Discount (%)</label>
                <input
                  type="number" min="0" max="100"
                  className="input text-sm"
                  placeholder="e.g. 20"
                  value={bulkUpdates.discount}
                  onChange={e => setBulkUpdates(p => ({ ...p, discount: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleBulkUpdate}
                disabled={bulkLoading}
                className="btn-primary text-sm py-1.5 px-4 disabled:opacity-50"
              >
                {bulkLoading ? '⏳ Updating...' : '✅ Apply Changes'}
              </button>
              <button
                onClick={() => { setShowBulkEdit(false); setBulkUpdates({ price: '', stock: '', discount: '' }); }}
                className="btn-secondary text-sm py-1.5 px-4"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700">
              <tr>
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="rounded"
                  />
                </th>
                {['Image', 'Name', 'Price', 'Stock', 'Status', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-gray-500 dark:text-gray-400 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableRowsSkeleton rows={5} columns={7} />
              ) : products.map(p => (
                <tr
                  key={p._id}
                  className={`border-b dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 ${selected.has(p._id) ? 'bg-primary-50 dark:bg-primary-900/10' : ''}`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(p._id)}
                      onChange={() => toggleOne(p._id)}
                      className="rounded"
                    />
                  </td>
                  <td className="px-4 py-3">
                    {p.images && p.images.length > 0 ? (
                      <img src={p.images[0]} alt={p.name} className="w-12 h-12 object-cover rounded" />
                    ) : (
                      <div className="w-12 h-12 bg-gray-200 dark:bg-gray-700 rounded flex items-center justify-center text-gray-400 text-xs">
                        No Image
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white max-w-xs truncate">{p.name}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">${p.price.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <span className={
                      p.stock === 0 ? 'text-red-600 font-medium' :
                      p.stock < 5  ? 'text-orange-500 font-medium' :
                                     'text-gray-700 dark:text-gray-300'
                    }>
                      {p.stock}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${p.isDeleted ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                      {p.isDeleted ? 'Deleted' : 'Active'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setUploadProduct(p)}
                        className="text-blue-600 hover:underline text-xs font-medium"
                        title="Upload Image"
                      >
                        📸 Image
                      </button>
                      <button
                        onClick={() => setModalProduct(p)}
                        className="text-primary-600 hover:underline text-xs font-medium"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(p._id)}
                        className="text-red-500 hover:underline text-xs"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex justify-center gap-2 p-4 border-t dark:border-gray-800">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-secondary px-3 py-1 text-sm">←</button>
            <span className="text-sm text-gray-600 dark:text-gray-400 flex items-center">Page {page} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn-secondary px-3 py-1 text-sm">→</button>
          </div>
        )}
      </div>

      {/* Product Form Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <ProductModal
            product={modalProduct}
            categories={categories}
            onClose={() => setModalProduct(undefined)}
            onSaved={fetchProducts}
          />
        )}
      </AnimatePresence>

      {/* Image Upload Modal */}
      <AnimatePresence>
        {uploadProduct && (
          <ImageUploadModal
            product={uploadProduct}
            onClose={() => setUploadProduct(null)}
            onUploaded={fetchProducts}
          />
        )}
      </AnimatePresence>

      {/* Plan Limit Modal */}
      <AnimatePresence>
        {showLimitModal && (
          <PlanLimitModal
            plan={plan}
            limit={productLimit}
            onClose={() => setShowLimitModal(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
