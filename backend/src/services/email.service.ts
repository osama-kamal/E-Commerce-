import axios from 'axios';
import { logger } from '../utils/logger';
import {
  welcomeTemplate,
  passwordResetTemplate,
  orderConfirmationTemplate,
  orderStatusTemplate,
  paymentReceiptTemplate,
  OrderEmailData,
  OrderStatusEmailData,
  PaymentEmailData,
  StoreBranding,
} from './email.templates';
import { Store } from '../modules/stores/store.model';

const PLATFORM_NAME = 'Ecommerce Store';
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

// ── EmailService ──────────────────────────────────────────────────────────────
// Uses Brevo HTTP API (not SMTP) — bypasses Railway's SMTP port blocking.
// Supports sending to any email address on the free tier (300 emails/day).

class EmailService {
  private enabled: boolean = false;
  private apiKey: string = '';
  private fromEmail: string = '';
  private fromName: string = '';
  private frontendUrl: string = '';

  constructor() {
    const apiKey = process.env.BREVO_API_KEY;
    this.fromEmail = process.env.EMAIL_FROM_ADDRESS ?? 'osamahamroush9@gmail.com';
    this.fromName = process.env.EMAIL_FROM_NAME ?? 'Ecommerce Store';
    this.frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';

    if (!apiKey) {
      logger.warn('BREVO_API_KEY not set — email sending is disabled');
      this.enabled = false;
      return;
    }

    this.apiKey = apiKey;
    this.enabled = true;

    logger.info('Brevo HTTP API email service initialised', {
      from: `${this.fromName} <${this.fromEmail}>`,
      frontendUrl: this.frontendUrl,
    });
  }

  // No-op kept for interface compatibility
  async verifyConnection(): Promise<void> {
    if (!this.enabled) {
      logger.warn('Email service disabled — skipping verification');
      return;
    }
    logger.info('✅ Brevo HTTP API email service ready');
  }

  // ── Core send ─────────────────────────────────────────────────────────────

  async sendEmail(options: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void> {
    if (!this.enabled) {
      logger.warn('Email service disabled — skipping send', {
        to: options.to,
        subject: options.subject,
      });
      return;
    }

    try {
      await axios.post(
        BREVO_API_URL,
        {
          sender: { name: this.fromName, email: this.fromEmail },
          to: [{ email: options.to }],
          subject: options.subject,
          htmlContent: options.html,
          textContent: options.text,
        },
        {
          headers: {
            'api-key': this.apiKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          timeout: 15000,
        }
      );

      logger.info('Email sent via Brevo API', {
        to: options.to,
        subject: options.subject,
      });
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: unknown; status?: number }; message?: string };
      logger.error('Failed to send email via Brevo API', {
        to: options.to,
        subject: options.subject,
        status: axiosError?.response?.status,
        data: axiosError?.response?.data,
        message: axiosError?.message,
      });
      throw err;
    }
  }

  // ── Store branding helper ─────────────────────────────────────────────────

  private async fetchStoreBranding(storeId: string | null | undefined): Promise<StoreBranding> {
    const DEFAULT_BRANDING: StoreBranding = { storeName: PLATFORM_NAME };

    if (!storeId || storeId.trim() === '') {
      logger.warn('fetchStoreBranding: storeId is missing — using default branding');
      return DEFAULT_BRANDING;
    }

    try {
      const store = await Store.findById(storeId).lean();
      if (!store) {
        logger.warn('fetchStoreBranding: store not found — using default branding', { storeId });
        return DEFAULT_BRANDING;
      }
      return {
        storeName: store.name,
        logoUrl: store.settings?.logoUrl || undefined,
        contactEmail: store.settings?.contactEmail || undefined,
        contactPhone: store.settings?.contactPhone || undefined,
      };
    } catch (err) {
      logger.error('fetchStoreBranding: DB query failed — using default branding', { storeId, error: err });
      return DEFAULT_BRANDING;
    }
  }

  // ── Typed send methods (fire-and-forget — never re-throw) ─────────────────

  async sendWelcomeEmail(storeId: string, to: string): Promise<void> {
    try {
      const branding = await this.fetchStoreBranding(storeId);
      const { html, text } = welcomeTemplate({ email: to, frontendUrl: this.frontendUrl }, branding);
      await this.sendEmail({ to, subject: `Welcome to ${branding.storeName}!`, html, text });
    } catch (err) {
      logger.error('Failed to send welcome email', { to, error: err });
    }
  }

  async sendPasswordResetEmail(storeId: string, to: string, resetToken: string): Promise<void> {
    try {
      const branding = await this.fetchStoreBranding(storeId);
      const resetUrl = `${this.frontendUrl}/reset-password?token=${resetToken}`;
      const { html, text } = passwordResetTemplate({ resetUrl, frontendUrl: this.frontendUrl }, branding);
      await this.sendEmail({ to, subject: 'Reset Your Password', html, text });
    } catch (err) {
      logger.error('Failed to send password reset email', { to, error: err });
    }
  }

  async sendOrderConfirmationEmail(storeId: string, to: string, order: OrderEmailData): Promise<void> {
    try {
      const branding = await this.fetchStoreBranding(storeId);
      const { html, text } = orderConfirmationTemplate({ ...order, frontendUrl: this.frontendUrl }, branding);
      await this.sendEmail({ to, subject: `Order Confirmed — #${order.orderId}`, html, text });
    } catch (err) {
      logger.error('Failed to send order confirmation email', { to, orderId: order.orderId, error: err });
    }
  }

  async sendOrderStatusEmail(storeId: string, to: string, order: OrderStatusEmailData): Promise<void> {
    try {
      const branding = await this.fetchStoreBranding(storeId);
      const { html, text } = orderStatusTemplate({ ...order, frontendUrl: this.frontendUrl }, branding);
      await this.sendEmail({ to, subject: `Order #${order.orderId} — Status Update: ${order.status}`, html, text });
    } catch (err) {
      logger.error('Failed to send order status email', { to, orderId: order.orderId, error: err });
    }
  }

  async sendPaymentReceiptEmail(storeId: string, to: string, payment: PaymentEmailData): Promise<void> {
    try {
      const branding = await this.fetchStoreBranding(storeId);
      const { html, text } = paymentReceiptTemplate({ ...payment, frontendUrl: this.frontendUrl }, branding);
      await this.sendEmail({ to, subject: `Payment Receipt — Order #${payment.orderId}`, html, text });
    } catch (err) {
      logger.error('Failed to send payment receipt email', { to, orderId: payment.orderId, error: err });
    }
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const emailService = new EmailService();
export { OrderEmailData, OrderStatusEmailData, PaymentEmailData };
