import { useQuery } from '@tanstack/react-query';
import { recommendationsApi } from '../api/recommendations';
import { Product } from '../types';
import ProductCard from './ProductCard';

interface RecommendedProductsProps {
  productId: string;
  title?: string;
}

export default function RecommendedProducts({ productId, title = '🤖 AI Recommendations - You May Also Like' }: RecommendedProductsProps) {
  const { data: recommendations = [], isLoading: loading } = useQuery({
    queryKey: ['product-recommendations', productId],
    queryFn: async () => {
      const res = await recommendationsApi.getProductRecommendations(productId, 6);
      return res.data.data.recommendations as Product[];
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    enabled: !!productId, // Only run query if productId exists
  });

  if (loading) {
    return (
      <div className="mt-12">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">{title}</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="bg-gray-300 dark:bg-gray-700 h-40 rounded-lg mb-3"></div>
              <div className="bg-gray-300 dark:bg-gray-700 h-4 rounded mb-2"></div>
              <div className="bg-gray-300 dark:bg-gray-700 h-4 rounded w-2/3"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (recommendations.length === 0) {
    return null;
  }

  return (
    <div className="mt-12">
      <div className="flex items-center gap-3 mb-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h2>
        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gradient-to-r from-purple-100 to-pink-100 dark:from-purple-900/30 dark:to-pink-900/30 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
          <span className="mr-1">✨</span> Powered by AI
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {recommendations.map((product, index) => (
          <ProductCard key={product._id} product={product} index={index} />
        ))}
      </div>
    </div>
  );
}
