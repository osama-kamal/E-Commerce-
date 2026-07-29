import { useNavigate } from 'react-router-dom';
import { Scale } from 'lucide-react';
import { useAppSelector, useAppDispatch } from '../hooks/useAppDispatch';
import { removeFromComparison, clearComparison } from '../store/comparisonSlice';
import StarRating from '../components/StarRating';
import toast from 'react-hot-toast';

export default function ComparePage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const products = useAppSelector((s) => s.comparison.products);

  if (products.length === 0) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <div className="max-w-md mx-auto">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800">
            <Scale className="h-9 w-9 text-gray-400" strokeWidth={1.5} aria-hidden="true" />
          </div>
          <h2 className="mb-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            Nothing to compare yet
          </h2>
          <p className="mx-auto mb-6 max-w-sm text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            Tick “Compare” on any product card to line up specs and prices side by side.
          </p>
          <button
            onClick={() => navigate('/')}
            className="btn-primary px-6 py-2"
          >
            Browse Products
          </button>
        </div>
      </div>
    );
  }

  const handleRemove = (productId: string) => {
    dispatch(removeFromComparison(productId));
    toast('Product removed from comparison');
  };

  const handleClearAll = () => {
    dispatch(clearComparison());
    toast.success('Comparison cleared');
    navigate('/');
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          Compare Products
        </h1>
        <div className="flex gap-3">
          <button
            onClick={handleClearAll}
            className="text-sm text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400"
          >
            Clear All
          </button>
          <button
            onClick={() => navigate('/')}
            className="btn-secondary px-4 py-2"
          >
            Back to Shop
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800">
              <th className="p-4 text-left text-sm font-semibold text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700 w-48">
                Feature
              </th>
              {products.map((product) => (
                <th
                  key={product._id}
                  className="p-4 text-center border-b border-gray-200 dark:border-gray-700 min-w-[200px]"
                >
                  <div className="relative">
                    <button
                      onClick={() => handleRemove(product._id)}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-sm flex items-center justify-center hover:bg-red-600"
                      aria-label="Remove"
                    >
                      ×
                    </button>
                    <img
                      src={product.images[0]}
                      alt={product.name}
                      className="w-32 h-32 object-cover rounded-lg mx-auto mb-3"
                    />
                    <h3 className="font-medium text-gray-900 dark:text-white text-sm">
                      {product.name}
                    </h3>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Price */}
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <td className="p-4 text-sm font-medium text-gray-700 dark:text-gray-300">
                Price
              </td>
              {products.map((product) => {
                const hasDiscount = product.discount > 0;
                const discountedPrice = hasDiscount
                  ? product.price * (1 - product.discount / 100)
                  : product.price;
                return (
                  <td key={product._id} className="p-4 text-center">
                    {hasDiscount ? (
                      <div>
                        <span className="text-lg font-bold text-red-600 dark:text-red-400">
                          ${discountedPrice.toFixed(2)}
                        </span>
                        <br />
                        <span className="text-sm text-gray-400 line-through">
                          ${product.price.toFixed(2)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-lg font-bold text-gray-900 dark:text-white">
                        ${product.price.toFixed(2)}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>

            {/* Discount */}
            <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
              <td className="p-4 text-sm font-medium text-gray-700 dark:text-gray-300">
                Discount
              </td>
              {products.map((product) => (
                <td key={product._id} className="p-4 text-center">
                  {product.discount > 0 ? (
                    <span className="inline-block bg-red-500 text-white text-xs font-bold px-2 py-1 rounded">
                      -{product.discount}% OFF
                    </span>
                  ) : (
                    <span className="text-sm text-gray-500">No discount</span>
                  )}
                </td>
              ))}
            </tr>

            {/* Rating */}
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <td className="p-4 text-sm font-medium text-gray-700 dark:text-gray-300">
                Rating
              </td>
              {products.map((product) => (
                <td key={product._id} className="p-4">
                  <div className="flex flex-col items-center gap-1">
                    <StarRating rating={product.averageRating} size="sm" />
                    <span className="text-xs text-gray-500">
                      ({product.reviewCount} reviews)
                    </span>
                  </div>
                </td>
              ))}
            </tr>

            {/* Stock Status */}
            <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
              <td className="p-4 text-sm font-medium text-gray-700 dark:text-gray-300">
                Stock Status
              </td>
              {products.map((product) => (
                <td key={product._id} className="p-4 text-center">
                  {product.stock === 0 ? (
                    <span className="inline-block bg-red-500 text-white text-xs font-semibold px-2 py-1 rounded">
                      Out of Stock
                    </span>
                  ) : product.stock <= 3 ? (
                    <span className="inline-block bg-orange-400 text-white text-xs font-semibold px-2 py-1 rounded">
                      Only {product.stock} left
                    </span>
                  ) : product.stock <= 10 ? (
                    <span className="inline-block bg-yellow-400 text-white text-xs font-semibold px-2 py-1 rounded">
                      Low Stock ({product.stock})
                    </span>
                  ) : (
                    <span className="inline-block bg-green-500 text-white text-xs font-semibold px-2 py-1 rounded">
                      In Stock ({product.stock})
                    </span>
                  )}
                </td>
              ))}
            </tr>

            {/* Description */}
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <td className="p-4 text-sm font-medium text-gray-700 dark:text-gray-300">
                Description
              </td>
              {products.map((product) => (
                <td key={product._id} className="p-4">
                  <p className="text-sm text-gray-600 dark:text-gray-400 text-left">
                    {product.description}
                  </p>
                </td>
              ))}
            </tr>

            {/* Actions */}
            <tr>
              <td className="p-4 text-sm font-medium text-gray-700 dark:text-gray-300">
                Actions
              </td>
              {products.map((product) => (
                <td key={product._id} className="p-4 text-center">
                  <button
                    onClick={() => navigate(`/products/${product._id}`)}
                    className="btn-primary px-4 py-2 text-sm w-full"
                  >
                    View Details
                  </button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
