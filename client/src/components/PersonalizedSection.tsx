import { useQuery } from '@tanstack/react-query';
import { recommendationsApi } from '../api/recommendations';
import { Product } from '../types';
import ProductCard from './ProductCard';
import { useAppSelector } from '../hooks/useAppDispatch';

export default function PersonalizedSection() {
  const isAuthenticated = useAppSelector(s => s.auth.isAuthenticated);

  const { data: recommendations = [], isLoading: loading, isFetching } = useQuery({
    queryKey: ['recommendations', isAuthenticated ? 'personalized' : 'trending'],
    queryFn: async () => {
      if (isAuthenticated) {
        const res = await recommendationsApi.getPersonalizedRecommendations(8);
        return res.data.data.recommendations as Product[];
      } else {
        const res = await recommendationsApi.getTrendingProducts(8);
        return res.data.data.products as Product[];
      }
    },
    staleTime: 10 * 60 * 1000, // 10 minutes - data stays fresh for 10 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes - cache persists for 30 minutes
  });

  // Show skeleton only on initial load, not when refetching
  if (loading && !recommendations.length) {
    return (
      <div className="mb-12">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
          {isAuthenticated ? '🎯 Recommended For You' : '🔥 Trending Now'}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="bg-gray-300 dark:bg-gray-700 h-48 rounded-lg mb-3"></div>
              <div className="bg-gray-300 dark:bg-gray-700 h-4 rounded mb-2"></div>
              <div className="bg-gray-300 dark:bg-gray-700 h-4 rounded w-2/3"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Always show the section, even if empty (backend should always return products now)
  return (
    <div className="mb-12">
      <div className="flex items-center gap-3 mb-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          {isAuthenticated ? '🎯 Recommended For You' : '🔥 Trending Now'}
        </h2>
        {isAuthenticated && (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gradient-to-r from-blue-100 to-purple-100 dark:from-blue-900/30 dark:to-purple-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            <span className="mr-1">🤖</span> AI Powered
          </span>
        )}
        {isFetching && (
          <span className="text-xs text-gray-400 animate-pulse">Updating...</span>
        )}
      </div>
      {recommendations.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-4">
          {recommendations.map((product, index) => (
            <ProductCard key={product._id} product={product} index={index} />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <p className="text-4xl mb-2">🔍</p>
          <p>No recommendations available at the moment</p>
        </div>
      )}
    </div>
  );
}
