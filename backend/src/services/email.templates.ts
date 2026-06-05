// ── Types ─────────────────────────────────────────────────────────────────────

export interface EmailBody {
  html: string;
  text: string;
}

export interface StoreBranding {
  storeName: string;
  logoUrl?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface OrderItemData {
  name: string;
  quantity: number;
  price: number;
}

export interface OrderEmailData {
  orderId: string;
  items: OrderItemData[];
  totalAmount: number;
  shippingAddress: {
    line1: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  createdAt: Date;
}

export interface OrderStatusEmailData {
  orderId: string;
  status: 'processing' | 'shipped' | 'delivered' | 'cancelled';
  updatedAt: Date;
}

export interface PaymentEmailData {
  orderId: string;
  amount: number; // in cents
  currency: string;
  paymentIntentId: string;
  paidAt: Date;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

const PLATFORM_NAME = 'Ecommerce Store';

function safe(value: unknown, fallback = 'N/A'): string {
  if (value === undefined || value === null || value === '') return fallback;
  const str = String(value);
  if (str === 'undefined' || str === 'null' || str === '[object Object]') return fallback;
  return str;
}

function formatDate(date: Date): string {
  try {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return 'N/A';
  }
}

function formatAmount(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function baseHtml(title: string, body: string, branding: StoreBranding = { storeName: PLATFORM_NAME }): string {
  const logoHtml = branding.logoUrl
    ? `<img src="${branding.logoUrl}" alt="${branding.storeName} logo" style="max-height:48px;margin-bottom:8px;" /><br/>`
    : '';

  const contactHtml =
    branding.contactEmail || branding.contactPhone
      ? `<br/>${branding.contactEmail ? `<a href="mailto:${branding.contactEmail}" style="color:#888;">${branding.contactEmail}</a>` : ''}${branding.contactEmail && branding.contactPhone ? ' &nbsp;|&nbsp; ' : ''}${branding.contactPhone ? `<span>${branding.contactPhone}</span>` : ''}`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 0; background: #f4f4f4; font-family: Arial, sans-serif; color: #333; }
    .wrapper { max-width: 600px; margin: 30px auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background: #1a1a2e; padding: 24px 32px; text-align: center; }
    .header h1 { margin: 0; color: #fff; font-size: 22px; letter-spacing: 1px; }
    .content { padding: 32px; }
    .footer { background: #f4f4f4; padding: 16px 32px; text-align: center; font-size: 12px; color: #888; border-top: 1px solid #e0e0e0; }
    .btn { display: inline-block; margin: 20px 0; padding: 12px 28px; background: #1a1a2e; color: #fff !important; text-decoration: none; border-radius: 5px; font-size: 15px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th { background: #f0f0f0; padding: 8px 12px; text-align: left; font-size: 13px; }
    td { padding: 8px 12px; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
    .total-row td { font-weight: bold; border-top: 2px solid #ddd; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">${logoHtml}<h1>${branding.storeName}</h1></div>
    <div class="content">${body}</div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} ${branding.storeName}. All rights reserved.<br/>
      You received this email because you have an account with us.
      If you no longer wish to receive these emails, you may <a href="#" style="color:#888;">unsubscribe</a>.${contactHtml}
    </div>
  </div>
</body>
</html>`;
}

// ── Welcome Template ──────────────────────────────────────────────────────────

export function welcomeTemplate(data: { email: string; frontendUrl: string }, branding: StoreBranding = { storeName: PLATFORM_NAME }): EmailBody {
  const email = safe(data.email);
  const shopUrl = safe(data.frontendUrl, 'http://localhost:5173');

  const html = baseHtml(
    `Welcome to ${branding.storeName}`,
    `<h2>Welcome aboard! 🎉</h2>
    <p>Hi <strong>${email}</strong>,</p>
    <p>Your account has been created successfully. We're thrilled to have you with us!</p>
    <p>Start exploring our products and find something you love.</p>
    <a href="${shopUrl}" class="btn">Shop Now</a>
    <p style="color:#888;font-size:13px;">If you didn't create this account, please ignore this email.</p>`,
    branding
  );

  const text = `Welcome to ${branding.storeName}!\n\nHi ${email},\n\nYour account has been created successfully.\n\nStart shopping at: ${shopUrl}\n\n© ${new Date().getFullYear()} ${branding.storeName}`;

  return { html, text };
}

// ── Password Reset Template ───────────────────────────────────────────────────

export function passwordResetTemplate(data: { resetUrl: string; frontendUrl: string }, branding: StoreBranding = { storeName: PLATFORM_NAME }): EmailBody {
  const resetUrl = safe(data.resetUrl);
  const frontendUrl = safe(data.frontendUrl, 'http://localhost:5173');

  const html = baseHtml(
    'Reset Your Password',
    `<h2>Password Reset Request</h2>
    <p>We received a request to reset your password. Click the button below to set a new password.</p>
    <a href="${resetUrl}" class="btn">Reset Password</a>
    <p>Or copy and paste this link into your browser:</p>
    <p style="word-break:break-all;font-size:13px;color:#555;">${resetUrl}</p>
    <p><strong>This link expires in 1 hour.</strong></p>
    <p style="color:#888;font-size:13px;">If you did not request a password reset, please ignore this email. Your password will remain unchanged.</p>`,
    branding
  );

  const text = `Password Reset Request\n\nClick the link below to reset your password:\n${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you did not request a password reset, please ignore this email.\n\n© ${new Date().getFullYear()} ${branding.storeName}`;

  return { html, text };
}

// ── Order Confirmation Template ───────────────────────────────────────────────

export function orderConfirmationTemplate(data: OrderEmailData & { frontendUrl: string }, branding: StoreBranding = { storeName: PLATFORM_NAME }): EmailBody {
  const orderId = safe(data.orderId);
  const totalAmount = typeof data.totalAmount === 'number' ? `$${data.totalAmount.toFixed(2)}` : 'N/A';
  const createdAt = formatDate(data.createdAt);
  const addr = data.shippingAddress ?? {};
  const addressStr = [
    safe(addr.line1),
    safe(addr.city),
    safe(addr.state),
    safe(addr.postalCode),
    safe(addr.country),
  ].filter((v) => v !== 'N/A').join(', ') || 'N/A';

  const itemRows = (data.items ?? [])
    .map(
      (item) =>
        `<tr>
          <td>${safe(item.name)}</td>
          <td>${safe(String(item.quantity))}</td>
          <td>$${typeof item.price === 'number' ? item.price.toFixed(2) : 'N/A'}</td>
        </tr>`
    )
    .join('');

  const itemsText = (data.items ?? [])
    .map((item) => `  - ${safe(item.name)} x${item.quantity} @ $${typeof item.price === 'number' ? item.price.toFixed(2) : 'N/A'}`)
    .join('\n');

  const html = baseHtml(
    'Order Confirmation',
    `<h2>Order Confirmed ✅</h2>
    <p>Thank you for your order! Here are your order details:</p>
    <p><strong>Order ID:</strong> ${orderId}</p>
    <p><strong>Date:</strong> ${createdAt}</p>
    <table>
      <thead><tr><th>Product</th><th>Qty</th><th>Price</th></tr></thead>
      <tbody>${itemRows}</tbody>
      <tfoot><tr class="total-row"><td colspan="2">Total</td><td>${totalAmount}</td></tr></tfoot>
    </table>
    <p><strong>Shipping Address:</strong><br/>${addressStr}</p>
    <p style="color:#888;font-size:13px;">You will receive another email when your order ships.</p>`,
    branding
  );

  const text = `Order Confirmed!\n\nOrder ID: ${orderId}\nDate: ${createdAt}\n\nItems:\n${itemsText}\n\nTotal: ${totalAmount}\nShipping to: ${addressStr}\n\n© ${new Date().getFullYear()} ${branding.storeName}`;

  return { html, text };
}

// ── Order Status Template ─────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  processing: 'Your order is being processed',
  shipped: 'Your order has been shipped',
  delivered: 'Your order has been delivered',
  cancelled: 'Your order has been cancelled',
};

export function orderStatusTemplate(data: OrderStatusEmailData & { frontendUrl: string }, branding: StoreBranding = { storeName: PLATFORM_NAME }): EmailBody {
  const orderId = safe(data.orderId);
  const status = safe(data.status);
  const updatedAt = formatDate(data.updatedAt);
  const statusLabel = STATUS_LABELS[status] ?? `Order status updated to: ${status}`;

  let extraHtml = '';
  let extraText = '';

  if (status === 'shipped') {
    extraHtml = `<p>📦 <strong>Estimated delivery:</strong> Please allow 3–7 business days for your order to arrive.</p>`;
    extraText = '\nEstimated delivery: Please allow 3-7 business days for your order to arrive.';
  } else if (status === 'cancelled') {
    extraHtml = `<p>If this cancellation was unexpected, please <a href="mailto:support@ecommercestore.com">contact our support team</a> and we'll be happy to help.</p>`;
    extraText = '\nIf this cancellation was unexpected, please contact our support team.';
  }

  const html = baseHtml(
    'Order Status Update',
    `<h2>Order Update 📬</h2>
    <p><strong>Order ID:</strong> ${orderId}</p>
    <p><strong>Status:</strong> <span style="color:#1a1a2e;font-weight:bold;">${status.toUpperCase()}</span></p>
    <p>${statusLabel}.</p>
    ${extraHtml}
    <p style="color:#888;font-size:13px;">Updated on: ${updatedAt}</p>`,
    branding
  );

  const text = `Order Status Update\n\nOrder ID: ${orderId}\nStatus: ${status.toUpperCase()}\n${statusLabel}.${extraText}\n\nUpdated on: ${updatedAt}\n\n© ${new Date().getFullYear()} ${branding.storeName}`;

  return { html, text };
}

// ── Payment Receipt Template ──────────────────────────────────────────────────

export function paymentReceiptTemplate(data: PaymentEmailData & { frontendUrl: string }, branding: StoreBranding = { storeName: PLATFORM_NAME }): EmailBody {
  const orderId = safe(data.orderId);
  const currency = safe(data.currency, 'usd');
  const amountStr = typeof data.amount === 'number' ? formatAmount(data.amount, currency) : 'N/A';
  const paymentIntentId = safe(data.paymentIntentId);
  const paidAt = formatDate(data.paidAt);

  const html = baseHtml(
    'Payment Receipt',
    `<h2>Payment Received 💳</h2>
    <p>Thank you! Your payment has been successfully processed.</p>
    <table>
      <tr><th>Order ID</th><td>${orderId}</td></tr>
      <tr><th>Amount</th><td>${amountStr}</td></tr>
      <tr><th>Currency</th><td>${currency.toUpperCase()}</td></tr>
      <tr><th>Transaction ID</th><td style="font-size:12px;">${paymentIntentId}</td></tr>
      <tr><th>Date</th><td>${paidAt}</td></tr>
    </table>
    <p style="color:#888;font-size:13px;">Please keep this receipt for your records.</p>`,
    branding
  );

  const text = `Payment Receipt\n\nOrder ID: ${orderId}\nAmount: ${amountStr}\nCurrency: ${currency.toUpperCase()}\nTransaction ID: ${paymentIntentId}\nDate: ${paidAt}\n\n© ${new Date().getFullYear()} ${branding.storeName}`;

  return { html, text };
}
