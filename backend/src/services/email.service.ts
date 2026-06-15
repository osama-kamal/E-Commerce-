import { Resend } from 'resend';
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

// ── EmailService ──────────────────────────────────────────────────────────────
// Uses the Resend SDK for transactional email delivery.
//
// Required env vars:
//   RESEND_API_KEY   — from resend.com → API Keys
//   EMAIL_FROM_ADDRESS — verified sender address, e.g. orders@yourdomain.com
//   EMAIL_FROM_NAME  — display name, e.g. "My Store"
//   ADMIN_BCC_EMAIL  — (optional) gets a BCC copy of every order confirmation

class EmailService {
  private enabled: boolean = false;
  private client: Resend | null = null;
  private fromEmail: string = '';
  private fromName: string = '';
  private frontendUrl: string = '';
  /** BCC address for admin order notifications (optional) */
  private adminBccEmail: string | undefined;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    this.fromEmail = process.env.EMAIL_FROM_ADDRESS ?? 'onboarding@resend.dev';
    this.fromName  = process.env.EMAIL_FROM_NAME    ?? PLATFORM_NAME;
    this.frontendUrl = process.env.FRONTEND_URL     ?? 'http://localhost:5173';
    this.adminBccEmail = process.env.ADMIN_BCC_EMAIL ?? undefined;

    if (!apiKey) {
      logger.warn('RESEND_API_KEY not set — email sending is disabled');
      this.enabled = false;
      return;
    }

    this.client  = new Resend(apiKey);
    this.enabled = true;

    logger.info('Resend email service initialised', {
      from: `${this.fromName} <${this.fromEmail}>`,
      adminBcc: this.adminBccEmail ?? '(none)',
      frontendUrl: this.frontendUrl,
    });
  }

  // No-op kept for interface compatibility (server.ts calls this at startup)
  async verifyConnection(): Promise<void> {
    if (!this.enabled) {
      logger.warn('Email service disabled — skipping verification');
      return;
    }
    logger.info('✅ Resend email service ready');
  }

  // ── Core send ─────────────────────────────────────────────────────────────

  async sendEmail(options: {
    to: string;
    subject: string;
    html: string;
    text: string;
    bcc?: string[];
  }): Promise<void> {
    if (!this.enabled || !this.client) {
      logger.warn('Email service disabled — skipping send', {
        to: options.to,
        subject: options.subject,
      });
      return;
    }

    try {
      const { error } = await this.client.emails.send({
        from: `${this.fromName} <${this.fromEmail}>`,
        to:   [options.to],
        subject: options.subject,
        html:    options.html,
        text:    options.text,
        ...(options.bcc?.length ? { bcc: options.bcc } : {}),
      });

      if (error) {
        logger.error('Resend API returned an error', {
          to: options.to,
          subject: options.subject,
          error,
        });
        throw new Error(`Resend error: ${error.message}`);
      }

      logger.info('Email sent via Resend', {
        to: options.to,
        subject: options.subject,
        bcc: options.bcc ?? [],
      });
    } catch (err) {
      logger.error('Failed to send email via Resend', {
        to: options.to,
        subject: options.subject,
        error: err,
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
        storeName:    store.name,
        logoUrl:      store.settings?.logoUrl       || undefined,
        contactEmail: store.settings?.contactEmail  || undefined,
        contactPhone: store.settings?.contactPhone  || undefined,
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

      // BCC the admin so they're notified of every new order.
      // The customer (to) does NOT see the BCC address.
      const bcc = this.adminBccEmail ? [this.adminBccEmail] : undefined;

      await this.sendEmail({
        to,
        subject: `Order Confirmed — #${order.orderId}`,
        html,
        text,
        ...(bcc ? { bcc } : {}),
      });
    } catch (err) {
      logger.error('Failed to send order confirmation email', { to, orderId: order.orderId, error: err });
    }
  }

  async sendOrderStatusEmail(storeId: string, to: string, order: OrderStatusEmailData): Promise<void> {
    try {
      const branding = await this.fetchStoreBranding(storeId);
      const { html, text } = orderStatusTemplate({ ...order, frontendUrl: this.frontendUrl }, branding);
      await this.sendEmail({
        to,
        subject: `Order #${order.orderId} — Status Update: ${order.status}`,
        html,
        text,
      });
    } catch (err) {
      logger.error('Failed to send order status email', { to, orderId: order.orderId, error: err });
    }
  }

  async sendPaymentReceiptEmail(storeId: string, to: string, payment: PaymentEmailData): Promise<void> {
    try {
      const branding = await this.fetchStoreBranding(storeId);
      const { html, text } = paymentReceiptTemplate({ ...payment, frontendUrl: this.frontendUrl }, branding);
      await this.sendEmail({
        to,
        subject: `Payment Receipt — Order #${payment.orderId}`,
        html,
        text,
      });
    } catch (err) {
      logger.error('Failed to send payment receipt email', { to, orderId: payment.orderId, error: err });
    }
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const emailService = new EmailService();
export { OrderEmailData, OrderStatusEmailData, PaymentEmailData };
