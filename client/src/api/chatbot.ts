import axios from './axios';

export const chatbotApi = {
  // Send message to chatbot
  chat: (message: string) =>
    axios.post('/chatbot/chat', { message }),
};
