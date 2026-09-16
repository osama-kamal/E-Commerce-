import { Types } from 'mongoose';
import { Product } from '../products/product.model';
import { Order } from '../orders/order.model';
import { OPENAI_API_KEY, OPENAI_MODEL } from '../../config';
import { logger } from '../../utils/logger';
import { createError } from '../../middleware/errorHandler';
import { formatMoney } from '../checkout/currency';
import { buildStoreContext, renderStoreFacts, StoreChatContext } from './store-context';

/**
 * Storefront shopping assistant.
 *
 * ── storeId is required, everywhere ───────────────────────────────────────────
 * It was optional on every function here, and the queries degraded to
 * store-less when it was absent: `const storeFilter = storeId ? {storeId} : {}`.
 * The route guarantees a tenant, so nothing leaked in practice — but that is the
 * same shape that left the recommendations module querying every store on the
 * platform, and it only held because of a guarantee made somewhere else. It is
 * now a required first parameter, so the compiler enforces at each call site
 * what the router happened to provide.
 *
 * ── The assistant only states what the merchant configured ────────────────────
 * See store-context.ts. The short version: the system prompt used to assert free
 * shipping over $50, a 30-day return policy and Stripe payments as universal
 * facts, on a platform where all three are per-store. Prices were rendered with
 * a hardcoded "$" regardless of the store's currency.
 */

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

/**
 * `storeId` is required and first. Both tools were already scoped correctly, but
 * they guarded it at runtime and returned an error string when it was missing —
 * a failure mode that only exists because the parameter was optional.
 */
async function executeTool(
  storeId: string,
  currency: string,
  name: string,
  args: Record<string, unknown>,
  userId?: string
): Promise<string> {
  const storeObjId = new Types.ObjectId(storeId);

  if (name === 'get_order_status') {
    if (!userId) {
      return JSON.stringify({ error: 'User is not logged in. Cannot fetch orders.' });
    }

    const limit = Math.min(Number(args.limit) || 3, 5);
    const orders = await Order.find({
      customerId: new Types.ObjectId(userId),
      storeId: storeObjId,
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('_id status totalAmount currency items createdAt')
      .lean();

    if (orders.length === 0) {
      return JSON.stringify({ message: 'No orders found for this customer.' });
    }

    return JSON.stringify(
      orders.map((o) => ({
        orderId: o._id.toString(),
        status: o.status,
        // The ORDER's own currency, not the store's current one — an order
        // snapshots the currency it was placed in, and a store that later
        // switched would otherwise have its history restated in the new one.
        total: formatMoney(o.totalAmount, o.currency ?? currency),
        itemCount: o.items.length,
        date: new Date(o.createdAt).toLocaleDateString(),
      }))
    );
  }

  if (name === 'search_products') {
    const limit = Math.min(Number(args.limit) || 4, 6);
    const mongoQuery: Record<string, unknown> = {
      storeId: storeObjId,
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
        price: formatMoney(p.price, currency),
        discount: p.discount > 0 ? `${p.discount}% OFF` : null,
        effectivePrice:
          p.discount > 0
            ? formatMoney(Math.round(p.price * (1 - p.discount / 100) * 100) / 100, currency)
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
   * Entry point — routes to the model or the rule-based fallback.
   *
   * Both paths take the store context, so the fallback answers with the same
   * facts as the model rather than a second, differently-wrong set of them.
   */
  async chat(storeId: string, message: string, userId?: string): Promise<string> {
    if (!storeId || !Types.ObjectId.isValid(storeId)) {
      throw createError('Store context is required', 400, 'BAD_REQUEST');
    }

    const ctx = await buildStoreContext(storeId);

    if (OPENAI_API_KEY && (OPENAI_API_KEY.startsWith('sk-') || OPENAI_API_KEY.startsWith('sk-proj-'))) {
      return this.chatWithOpenAI(storeId, ctx, message, userId);
    }

    logger.warn('[Chatbot] No valid OpenAI key — using rule-based fallback', {
      keyPresent: !!OPENAI_API_KEY,
    });
    return this.ruleBasedChat(storeId, ctx, message.toLowerCase().trim(), userId);
  },

  /**
   * OpenAI chat with function calling (Tools API).
   * Supports one round of tool calls before returning the final answer.
   */
  async chatWithOpenAI(
    storeId: string,
    ctx: StoreChatContext,
    message: string,
    userId?: string
  ): Promise<string> {
    try {
      const systemPrompt = `You are a helpful and friendly shopping assistant for "${ctx.storeName}", an online store.

Verified facts about THIS store — these are the only store facts you may state:
${renderStoreFacts(ctx)}

Rules about facts:
- NEVER invent or assume a returns policy, refund window, warranty, delivery
  time, or payment method. None of those are listed above, which means this
  store has not published them.
- If asked about any of those, say you do not have that detail and point the
  customer to the store's contact details above (or ask them to check the
  store's policy pages if no contact is listed).
- Quote every price exactly as the tools return it. Prices are already formatted
  in ${ctx.currency} — never convert them, never add a currency symbol yourself.
${userId ? '- The customer IS logged in — you CAN call get_order_status.' : '- The customer is NOT logged in — do NOT call get_order_status; ask them to sign in.'}

Style:
- Use emojis to make responses engaging and warm
- Keep responses concise (under 200 words)
- When asked about products, offers, or recommendations → call search_products
- Support both English and Arabic naturally`;

      const messages: OpenAIMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ];

      const firstResponse = await this.callOpenAI(messages);
      const firstChoice = firstResponse.choices[0];

      if (firstChoice.finish_reason !== 'tool_calls' || !firstChoice.message.tool_calls?.length) {
        return firstChoice.message.content ?? '😔 I couldn\'t generate a response. Please try again.';
      }

      const toolCallMessages: OpenAIMessage[] = [...messages, firstChoice.message];

      for (const toolCall of firstChoice.message.tool_calls) {
        let toolArgs: Record<string, unknown> = {};
        try {
          toolArgs = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
        } catch {
          toolArgs = {};
        }

        logger.info('[Chatbot] Calling tool', { tool: toolCall.function.name, storeId });
        const toolResult = await executeTool(
          storeId,
          ctx.currency,
          toolCall.function.name,
          toolArgs,
          userId
        );

        toolCallMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolResult,
        });
      }

      const finalResponse = await this.callOpenAI(toolCallMessages, false);
      return finalResponse.choices[0].message.content ?? '😔 I couldn\'t generate a response. Please try again.';

    } catch (error) {
      logger.error('[Chatbot] OpenAI API error — falling back to rule-based', { error });
      return this.ruleBasedChat(storeId, ctx, message.toLowerCase(), userId);
    }
  },

  /** Low-level OpenAI API call. */
  async callOpenAI(messages: OpenAIMessage[], includeTools = true): Promise<OpenAIResponse> {
    const body: Record<string, unknown> = {
      model: OPENAI_MODEL,
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
      logger.error('[Chatbot] OpenAI HTTP error', { status: response.status });
      throw new Error(`OpenAI API error: ${response.status} ${errorBody}`);
    }

    return response.json() as Promise<OpenAIResponse>;
  },

  /**
   * Rule-based fallback — works with no API key.
   *
   * Grounded in the same context as the model path. It previously recited the
   * same four invented facts in fixed prose ("Free shipping on orders over $50",
   * "30-day return window", "Secure payment via Stripe"), which made the
   * no-API-key path the MOST confidently wrong one.
   */
  async ruleBasedChat(
    storeId: string,
    ctx: StoreChatContext,
    message: string,
    userId?: string
  ): Promise<string> {
    const storeObjId = new Types.ObjectId(storeId);

    /** Where to send anything this store has not published. */
    const referToStore = (): string => {
      if (ctx.contactEmail && ctx.contactPhone) {
        return `Please contact ${ctx.storeName} at ${ctx.contactEmail} or ${ctx.contactPhone}.`;
      }
      if (ctx.contactEmail) return `Please contact ${ctx.storeName} at ${ctx.contactEmail}.`;
      if (ctx.contactPhone) return `Please contact ${ctx.storeName} at ${ctx.contactPhone}.`;
      return `Please check ${ctx.storeName}'s policy pages or get in touch with the store directly.`;
    };

    if (this.matchesAny(message, ['hello', 'hi', 'hey', 'مرحبا', 'السلام عليكم'])) {
      return `👋 Hello! Welcome to ${ctx.storeName}! How can I help you today?\n\nI can help you with:\n• Finding products\n• Tracking orders\n• Product recommendations\n\nJust ask me anything!`;
    }

    if (this.matchesAny(message, ['product', 'find', 'search', 'looking for', 'منتج', 'ابحث'])) {
      const products = await Product.find({
        storeId: storeObjId, stock: { $gt: 0 }, isDeleted: false,
      })
        .sort({ averageRating: -1 })
        .limit(3)
        .select('name price averageRating reviewCount')
        .lean();

      if (products.length > 0) {
        let response = '🔍 Here are some popular products:\n\n';
        products.forEach((p, i) => {
          response += `${i + 1}. **${p.name}** - ${formatMoney(p.price, ctx.currency)}\n`;
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

      const recentOrder = await Order.findOne({
        storeId: storeObjId,
        customerId: new Types.ObjectId(userId),
      })
        .sort({ createdAt: -1 })
        .select('_id status totalAmount currency createdAt')
        .lean();

      if (recentOrder) {
        return `📦 Your most recent order:\n\n**Order ID:** ${recentOrder._id}\n**Status:** ${recentOrder.status}\n**Total:** ${formatMoney(recentOrder.totalAmount, recentOrder.currency ?? ctx.currency)}\n**Date:** ${new Date(recentOrder.createdAt).toLocaleDateString()}\n\nYou can view full details in your Orders page.`;
      }
      return "📦 You don't have any orders yet. Browse our products and place your first order!";
    }

    if (this.matchesAny(message, ['recommend', 'suggest', 'best', 'popular', 'trending', 'offer', 'offers', 'deal', 'deals', 'discount', 'sale', 'اقتراح', 'افضل', 'عروض', 'خصم'])) {
      const trending = await Product.find({
        storeId: storeObjId, stock: { $gt: 0 }, isDeleted: false, averageRating: { $gte: 4 },
      })
        .sort({ reviewCount: -1, averageRating: -1 })
        .limit(3)
        .select('name price discount averageRating')
        .lean();

      if (trending.length > 0) {
        let response = '⭐ Here are our top trending products:\n\n';
        trending.forEach((p, i) => {
          response += `${i + 1}. **${p.name}**\n`;
          response += `   💰 ${formatMoney(p.price, ctx.currency)}`;
          if (p.discount > 0) response += ` (${p.discount}% OFF!)`;
          response += `\n   ⭐ ${p.averageRating.toFixed(1)} stars\n\n`;
        });
        return response;
      }
    }

    // ── Shipping: stated ONLY from what the merchant configured ───────────────
    if (this.matchesAny(message, ['ship', 'shipping', 'شحن'])) {
      if (!ctx.shipping.configured) {
        return `🚚 I don't have delivery details for ${ctx.storeName}. ${referToStore()}`;
      }
      let response = '🚚 **Delivery:**\n\n';
      if (ctx.shipping.countries.length > 0) {
        response += `• Delivers to: ${ctx.shipping.countries.slice(0, 15).join(', ')}\n`;
      }
      if (ctx.shipping.cheapestRateLabel) {
        response += `• From ${ctx.shipping.cheapestRateLabel}\n`;
      }
      if (ctx.shipping.freeOverLabel) {
        response += `• Free delivery on orders over ${ctx.shipping.freeOverLabel}\n`;
      }
      response += '\nExact delivery cost is calculated at checkout for your address.';
      return response;
    }

    // ── Returns: no data exists, so no claim is made ──────────────────────────
    if (this.matchesAny(message, ['return', 'refund', 'exchange', 'استرجاع', 'استبدال'])) {
      return `🔄 I don't have ${ctx.storeName}'s returns policy on hand. ${referToStore()}`;
    }

    if (this.matchesAny(message, ['payment', 'pay', 'credit card', 'دفع', 'بطاقة'])) {
      return `💳 Checkout is secure, and you'll see the payment options available for your order at checkout. Prices are charged in ${ctx.currency}.\n\nFor anything specific, ${referToStore().charAt(0).toLowerCase()}${referToStore().slice(1)}`;
    }

    if (this.matchesAny(message, ['price', 'cost', 'how much', 'سعر', 'كام'])) {
      return `💰 Prices at ${ctx.storeName} are shown in ${ctx.currency}${ctx.taxNames.length > 0 && ctx.pricesIncludeTax ? ' and include tax' : ''}.\n\nYou can:\n• Filter by price range\n• Sort by price (low to high)\n• Check for discounts and offers\n\nWhat type of product are you looking for?`;
    }

    if (this.matchesAny(message, ['help', 'support', 'contact', 'مساعدة', 'دعم'])) {
      return `🆘 **How can I help you?**\n\nI can assist with:\n• 🔍 Finding products\n• 📦 Tracking orders\n• 💰 Pricing information\n\n${referToStore()}`;
    }

    if (this.matchesAny(message, ['thank', 'thanks', 'شكرا', 'متشكر'])) {
      return "😊 You're welcome! Happy to help!\n\nIs there anything else I can assist you with?";
    }

    if (this.matchesAny(message, ['bye', 'goodbye', 'see you', 'مع السلامة'])) {
      return `👋 Goodbye! Thanks for visiting ${ctx.storeName}. Come back soon!\n\nHappy shopping! 🛍️`;
    }

    return "🤔 I'm not sure I understand. Let me help you!\n\nYou can ask me about:\n• Products and recommendations\n• Order tracking\n• Pricing\n\nWhat would you like to know?";
  },

  /**
   * Whole-word keyword matching.
   *
   * This was `message.includes(keyword)`, which matches inside other words. The
   * greeting list contains "hi", so "how much is s-HI-pping?" was answered with
   * "👋 Hello! Welcome to …" — and the greeting rule is evaluated first, so it
   * swallowed the shipping, returns and payment questions before their own
   * branches could run. "hi" also hits *this*, *which*, *white*, *history*;
   * "hey" hits *they*.
   *
   * Boundaries are expressed as "not a letter or digit" via Unicode property
   * escapes rather than `\b`. `\b` is defined on `[A-Za-z0-9_]`, so for the
   * Arabic keywords here a space-to-Arabic transition is non-word to non-word
   * and no boundary exists — `\bمرحبا\b` never matches. `\p{L}` and `\p{N}` with
   * the `u` flag treat both scripts alike.
   */
  matchesAny(message: string, keywords: string[]): boolean {
    return keywords.some((keyword) => {
      const escaped = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Leading boundary, optional plural suffix, trailing boundary.
      //
      //   leading  — stops "hi" matching inside s-HI-pping / t-HI-s / w-HI-ch
      //   (e?s)?   — lets "product" match "products" and "search" match
      //              "searches", which strict whole-word matching would miss
      //   trailing — stops "hi" matching HI-story, which a leading-only
      //              boundary would allow and which would hijack "order history"
      return new RegExp(
        `(^|[^\\p{L}\\p{N}])${escaped}(e?s)?($|[^\\p{L}\\p{N}])`,
        'u'
      ).test(message);
    });
  },
};
