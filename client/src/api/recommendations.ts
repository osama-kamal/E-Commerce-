import axios from './axios';

export const recommendationsApi = {
  // Get AI recommendations for a specific product
  getProductRecommendations: (productId: string, limit = 6) =>
    axios.get(`/products/${productId}/recommendations`, { params: { limit } }),

  // Get personalized recommendations for logged-in user
  getPersonalizedRecommendations: (limit = 8) =>
    axios.get('/recommendations/personalized', { params: { limit } }),

  // Get trending products
  getTrendingProducts: (limit = 8) =>
    axios.get('/recommendations/trending', { params: { limit } }),
};
