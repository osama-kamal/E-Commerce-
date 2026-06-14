import { Types } from 'mongoose';
import { Product } from '../products/product.model';
import { Order } from '../orders/order.model';
import { OPENAI_API_KEY } from '../../config';

// ── Tool definitions sent to OpenAI ──────────────────────────────────────────

const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'get_order_status',
      description: 'Fetch the latest orders for the current customer. Use when the user asks about their order, delivery status, or tracking.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'How many recent orders to return (default 3, max 5)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_products',
      description: 'Search or browse store products. Use when the user asks to find, recommend, or browse products, offers, or deals.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Optional search term (e.g. "shoes", "laptop")',
          },
          onSale: {
            type: 'boolean',
            description: 'Set to true to return only discounted/sale products',
          },
          limit: {
            type: 'number',
            description: 'How many products to return (default 4, max 6)',
          },
          sortBy: {
            type: 'string',
            enum: ['rating', 'price_asc', 'price_desc', 'newest'],
            description: 'How to sort results',
          },
        },
        required: [],
      },
    },
  },
];

// ── Tool executor ─────────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  userId?: string,
  storeId?: string
): Promise<string> {
  if (name === 'get_order_status') {
    if (!userId) {
      return JSON.stringify({ error: 'User is not logged in. Cannot fetch orders.' });
    }
    if (!storeId) {
      return JSON.stringify({ error: 'Store context unavailable. Cannot fetch orders.' });
    }
    const limit = Math.min(Number(args.limit) || 3, 5);
    // Scope to both customerId AND storeId — prevents cross-tenant data leakage
    const orders = await Order.find({
      customerId: new Types.ObjectId(userId),
      storeId: new Types.ObjectId(storeId),
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('_id status totalAmount items createdAt')
      .lean();

    if (orders.length === 0) {
      return JSON.stringify({ message: 'No orders found for this customer.' });
    }

    return JSON.stringify(
      orders.map((o) => ({
        orderId: o._id.toString(),
        status: o.status,
        total: `$${o.totalAmount.toFixed(2)}`,
        itemCount: o.items.length,
        date: new Date(o.createdAt).toLocaleDateString(),
      }))
    );
  }

  if (name === 'search_products') {
    if (!storeId) {
      return JSON.stringify({ error: 'Store context unavailable. Cannot search products.' });
    }
    const limit = Math.min(Number(args.limit) || 4, 6);
    // Always scope to the resolved store — prevents cross-tenant product leakage
    const mongoQuery: Record<string, unknown> = {
      storeId: new Types.ObjectId(storeId),
      stock: { $gt: 0 },
      isDeleted: false,
    };

    if (args.onSale === true) {
      mongoQuery.discount = { $gt: 0 };
    }

    if (typeof args.query === 'string' && args.query.trim()) {
      const pattern = new RegExp(args.query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      mongoQuery.$or = [{ name: { $regex: pattern } }, { description: { $regex: pattern } }];
    }

    let sortOption: Record<string, 1 | -1> = { averageRating: -1, reviewCount: -1 };
    if (args.sortBy === 'price_asc') sortOption = { price: 1 };
    else if (args.sortBy === 'price_desc') sortOption = { price: -1 };
    else if (args.sortBy === 'newest') sortOption = { createdAt: -1 };

    const products = await Product.find(mongoQuery)
      .sort(sortOption)
      .limit(limit)
      .select('name price discount averageRating reviewCount stock')
      .lean();

    if (products.length === 0) {
      return JSON.stringify({ message: 'No matching products found.' });
    }

    return JSON.stringify(
      products.map((p) => ({
        name: p.name,
        price: `$${p.price.toFixed(2)}`,
        discount: p.discount > 0 ? `${p.discount}% OFF` : null,
        effectivePrice:
          p.discount > 0
            ? `$${(p.price * (1 - p.discount / 100)).toFixed(2)}`
            : null,
        rating: `${p.averageRating.toFixed(1)} ⭐ (${p.reviewCount} reviews)`,
        inStock: p.stock > 0,
      }))
    );
  }

  return JSON.stringify({ error: `Unknown tool: ${name}` });
}

// ── Types ─────────────────────────────────────────────────────────────────────

type OpenAIRole = 'user' | 'assistant' | 'system' | 'tool';

interface OpenAIMessage {
  role: OpenAIRole;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface OpenAIResponse {
  choices: Array<{
    message: OpenAIMessage;
    finish_reason: string;
  }>;
}

// ── Main service ──────────────────────────────────────────────────────────────

export const chatbotService = {
  /**
   * Entry point — routes to AI or rule-based depending on key availability
   */
  async chat(message: string, userId?: string, storeId?: string): Promise<string> {
    const lowerMessage = message.toLowerCase().trim();

    if (OPENAI_API_KEY && (OPENAI_API_KEY.startsWith('sk-') || OPENAI_API_KEY.startsWith('sk-proj-'))) {
      console.log('[Chatbot] OpenAI key found, attempting AI response...');
      return await this.chatWithOpenAI(message, userId, storeId);
    }

    console.warn('[Chatbot] No valid OpenAI key — using rule-based fallback. Key present:', !!OPENAI_API_KEY);
    return await this.ruleBasedChat(lowerMessage, userId, storeId);
  },

  /**
   * OpenAI chat with function calling (Tools API)
   * Supports up to one round of tool calls before returning the final answer.
   */
  async chatWithOpenAI(message: string, userId?: string, storeId?: string): Promise<string> {
    try {
      const productFilter: Record<string, unknown> = { isDeleted: false };
      if (storeId) productFilter.storeId = new Types.ObjectId(storeId);

      const productsCount = await Product.countDocuments(productFilter);
      const categories = await Product.distinct('category', productFilter);

      const systemPrompt = `You are a helpful and friendly AI shopping assistant for an e-commerce store.

Store Information:
- ${productsCount} products across ${categories.length} categories
- Free shipping on orders over $50
- 30-day return policy
- Secure payments via Stripe
${userId ? '- The customer IS logged in — you CAN call get_order_status.' : '- The customer is NOT logged in — do NOT call get_order_status.'}

Guidelines:
- Use emojis to make responses engaging and warm
- Keep responses concise (under 200 words)
- When asked about products, offers, or recommendations → call search_products
- When asked about orders, delivery, or tracking → call get_order_status (only if logged in)
- Support both English and Arabic naturally`;

      const messages: OpenAIMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ];

      // ── First call — model decides whether to invoke a tool ────────────────
      const firstResponse = await this.callOpenAI(messages);
      const firstChoice = firstResponse.choices[0];

      // No tool calls — return the direct text answer
      if (firstChoice.finish_reason !== 'tool_calls' || !firstChoice.message.tool_calls?.length) {
        return firstChoice.message.content ?? '😔 I couldn\'t generate a response. Please try again.';
      }

      // ── Execute all requested tools ────────────────────────────────────────
      const toolCallMessages: OpenAIMessage[] = [
        ...messages,
        firstChoice.message, // assistant message with tool_calls
      ];

      for (const toolCall of firstChoice.message.tool_calls) {
        let toolArgs: Record<string, unknown> = {};
        try {
          toolArgs = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
        } catch {
          toolArgs = {};
        }

        console.log(`[Chatbot] Calling tool: ${toolCall.function.name}`, toolArgs);
        const toolResult = await executeTool(toolCall.function.name, toolArgs, userId, storeId);

        toolCallMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolResult,
        });
      }

      // ── Second call — model synthesises tool results into a final answer ───
      const finalResponse = await this.callOpenAI(toolCallMessages, false);
      return finalResponse.choices[0].message.content ?? '😔 I couldn\'t generate a response. Please try again.';

    } catch (error) {
      console.error('[Chatbot] OpenAI API error — falling back to rule-based:', error);
      return await this.ruleBasedChat(message.toLowerCase(), userId, storeId);
    }
  },

  /**
   * Low-level OpenAI API call
   */
  async callOpenAI(messages: OpenAIMessage[], includeTools = true): Promise<OpenAIResponse> {
    const body: Record<string, unknown> = {
      model: 'gpt-3.5-turbo',
      messages,
      max_tokens: 400,
      temperature: 0.7,
    };

    if (includeTools) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('[Chatbot] OpenAI HTTP error:', response.status, errorBody);
      throw new Error(`OpenAI API error: ${response.status} ${errorBody}`);
    }

    return response.json() as Promise<OpenAIResponse>;
  },

  /**
   * Rule-based fallback — works with no API key
   */
  async ruleBasedChat(message: string, userId?: string, storeId?: string): Promise<string> {
    const storeFilter = storeId ? { storeId: new Types.ObjectId(storeId) } : {};

    if (this.matchesAny(message, ['hello', 'hi', 'hey', 'مرحبا', 'السلام عليكم'])) {
      return '👋 Hello! Welcome to our store! How can I help you today?\n\nI can help you with:\n• Finding products\n• Tracking orders\n• Product recommendations\n• Store policies\n\nJust ask me anything!';
    }

    if (this.matchesAny(message, ['product', 'find', 'search', 'looking for', 'منتج', 'ابحث'])) {
      const products = await Product.find({ ...storeFilter, stock: { $gt: 0 }, isDeleted: false })
        .sort({ averageRating: -1 })
        .limit(3)
        .select('name price averageRating reviewCount')
        .lean();

      if (products.length > 0) {
        let response = '🔍 Here are some popular products:\n\n';
        products.forEach((p, i) => {
          response += `${i + 1}. **${p.name}** - $${p.price.toFixed(2)}\n`;
          response += `   ⭐ ${p.averageRating.toFixed(1)} (${p.reviewCount} reviews)\n\n`;
        });
        response += 'Would you like to know more about any of these?';
        return response;
      }
    }

    if (this.matchesAny(message, ['order', 'track', 'delivery', 'طلب', 'توصيل'])) {
      if (!userId) {
        return '📦 To track your order, please log in to your account first.\n\nOnce logged in, you can:\n• View all your orders\n• Track delivery status\n• See order history';
      }

      const orderFilter: Record<string, unknown> = { customerId: new Types.ObjectId(userId) };
      if (storeId) orderFilter.storeId = new Types.ObjectId(storeId);

      const recentOrder = await Order.findOne(orderFilter)
        .sort({ createdAt: -1 })
        .select('_id status totalAmount createdAt')
        .lean();

      if (recentOrder) {
        return `📦 Your most recent order:\n\n**Order ID:** ${recentOrder._id}\n**Status:** ${recentOrder.status}\n**Total:** $${recentOrder.totalAmount.toFixed(2)}\n**Date:** ${new Date(recentOrder.createdAt).toLocaleDateString()}\n\nYou can view full details in your Orders page.`;
      } else {
        return "📦 You don't have any orders yet. Browse our products and place your first order!";
      }
    }

    if (this.matchesAny(message, ['recommend', 'suggest', 'best', 'popular', 'trending', 'offer', 'offers', 'deal', 'deals', 'discount', 'sale', 'اقتراح', 'افضل', 'عروض', 'خصم'])) {
      const trending = await Product.find({ ...storeFilter, stock: { $gt: 0 }, isDeleted: false, averageRating: { $gte: 4 } })
        .sort({ reviewCount: -1, averageRating: -1 })
        .limit(3)
        .select('name price discount averageRating')
        .lean();

      if (trending.length > 0) {
        let response = '⭐ Here are our top trending products:\n\n';
        trending.forEach((p, i) => {
          response += `${i + 1}. **${p.name}**\n`;
          response += `   💰 $${p.price.toFixed(2)}`;
          if (p.discount > 0) response += ` (${p.discount}% OFF!)`;
          response += `\n   ⭐ ${p.averageRating.toFixed(1)} stars\n\n`;
        });
        return response;
      }
    }

    if (this.matchesAny(message, ['price', 'cost', 'how much', 'سعر', 'كام'])) {
      return '💰 Our products range from affordable to premium options.\n\nYou can:\n• Filter by price range\n• Sort by price (low to high)\n• Check for discounts and offers\n\nWhat type of product are you looking for?';
    }

    if (this.matchesAny(message, ['ship', 'shipping', 'شحن'])) {
      return '🚚 **Shipping Information:**\n\n• Free shipping on orders over $50\n• Standard delivery: 3-5 business days\n• Express delivery: 1-2 business days\n• Track your order anytime\n\nShipping costs are calculated at checkout based on your location.';
    }

    if (this.matchesAny(message, ['return', 'refund', 'exchange', 'استرجاع', 'استبدال'])) {
      return '🔄 **Return Policy:**\n\n• 30-day return window\n• Items must be unused and in original packaging\n• Free returns on defective items\n• Refund processed within 5-7 business days\n\nNeed to return something? Contact our support team!';
    }

    if (this.matchesAny(message, ['payment', 'pay', 'credit card', 'دفع', 'بطاقة'])) {
      return '💳 **Payment Methods:**\n\nWe accept:\n• Credit/Debit Cards (Visa, Mastercard)\n• Secure payment via Stripe\n• All transactions are encrypted\n\nYour payment information is safe with us!';
    }

    if (this.matchesAny(message, ['help', 'support', 'contact', 'مساعدة', 'دعم'])) {
      return '🆘 **How can I help you?**\n\nI can assist with:\n• 🔍 Finding products\n• 📦 Tracking orders\n• 💰 Pricing information\n• 🚚 Shipping details\n• 🔄 Returns & refunds\n• 💳 Payment methods\n\nJust ask me anything!';
    }

    if (this.matchesAny(message, ['thank', 'thanks', 'شكرا', 'متشكر'])) {
      return "😊 You're welcome! Happy to help!\n\nIs there anything else I can assist you with?";
    }

    if (this.matchesAny(message, ['bye', 'goodbye', 'see you', 'مع السلامة'])) {
      return '👋 Goodbye! Thanks for visiting our store. Come back soon!\n\nHappy shopping! 🛍️';
    }

    return "🤔 I'm not sure I understand. Let me help you!\n\nYou can ask me about:\n• Products and recommendations\n• Order tracking\n• Shipping and delivery\n• Returns and refunds\n• Payment methods\n\nWhat would you like to know?";
  },

  matchesAny(message: string, keywords: string[]): boolean {
    return keywords.some((keyword) => message.includes(keyword.toLowerCase()));
  },
};
