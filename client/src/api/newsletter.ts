import axios from './axios';

export const newsletterApi = {
  subscribe: (email: string) =>
    axios.post('/newsletter/subscribe', { email }),

  unsubscribe: (email: string) =>
    axios.post('/newsletter/unsubscribe', { email }),

  getSubscribers: (activeOnly = true) =>
    axios.get('/newsletter/subscribers', { params: { activeOnly } }),

  getStats: () =>
    axios.get('/newsletter/stats'),

  sendNewsletter: (subject: string, message: string) =>
    axios.post('/newsletter/send', { subject, message }),
};
