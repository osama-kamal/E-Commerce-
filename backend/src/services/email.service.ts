import nodemailer from 'nodemailer';
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
// Uses Brevo (Sendinblue) SMTP — supports sending to any email address on the
// free tier (300 emails/day). No domain verification required.

class EmailService {
  private transporter!: nodemailer.Transporter;
  private enabled: boolean = false;
  private fromAddress: string = '';
  private frontendUrl: string = '';

  constructor() {
    const apiKey = process.env.BREVO_API_KEY;
    const fromEmail = process.env.EMAIL_FROM_ADDRESS ?? 'osamahamroush9@gmail.com';
    const fromName = process.env.EMAIL_FROM_NAME ?? 'Ecommerce Store';
    this.frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';

    if (!apiKey) {
      logger.warn('BREVO_API_KEY not set — email sending is disabled');
      this.enabled = false;
      return;
    }

    this.fromAddress = `"${fromName}" <${fromEmail}>`;
    this.enabled = true;

    // Brevo SMTP credentials:
    // user  = your Brevo account email (any verified sender)
    // pass  = the SMTP key (xsmtpsib-...)
    this.transporter = nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false, // STARTTLS
      auth: {
        user: fromEmail,
        pass: apiKey,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });

    logger.info('Brevo SMTP email service initialised', {
      host: 'smtp-relay.brevo.com',
      port: 587,
      from: this.fromAddress,
      frontendUrl: this.frontendUrl,
    });
  }

  async verifyConnection(): Promise<void> {
    if (!this.enabled) {
      logger.warn('Email service disabled — skipping SMTP verification');
      return;
    }
    try {
      await this.transporter.verify();
      logger.info('✅ Brevo SMTP connection verified — email service ready');
    } catch (err) {
      logger.error('❌ Brevo SMTP verification failed', { error: err });
    }
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
      await this.transporter.sendMail({
        from: this.fromAddress,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });
      logger.info('Email sent via Brevo', { to: options.to, subject: options.subject });
    } catch (err) {
      logger.error('Failed to send email via Brevo', {
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
