import { Request, Response, NextFunction } from 'express';
import { emailService } from '../../services/email.service';
import { logger } from '../../utils/logger';
import { config } from '../../config/index';
import { escapeHtml } from '../../utils/escapeHtml';

export async function contactSales(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, storeName, phone, requirements } = req.body as {
      name: string;
      storeName: string;
      phone: string;
      requirements: string;
    };

    // Basic validation (schema-level validation is handled by Zod middleware)
    if (!name || !storeName || !phone) {
      res.status(400).json({ success: false, message: 'name, storeName and phone are required' });
      return;
    }

    const html = `
      <div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px">
        <h2 style="color:#4f46e5;margin-bottom:16px">🏢 New Enterprise Inquiry</h2>
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:8px 0;font-weight:600;color:#374151;width:140px">Name</td>
            <td style="padding:8px 0;color:#111827">${escapeHtml(name)}</td>
          </tr>
          <tr style="background:#f9fafb">
            <td style="padding:8px 0;font-weight:600;color:#374151">Store / Business</td>
            <td style="padding:8px 0;color:#111827">${escapeHtml(storeName)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;font-weight:600;color:#374151">Phone</td>
            <td style="padding:8px 0;color:#111827">${escapeHtml(phone)}</td>
          </tr>
          <tr style="background:#f9fafb">
            <td style="padding:8px 0;font-weight:600;color:#374151;vertical-align:top">Requirements</td>
            <td style="padding:8px 0;color:#111827;white-space:pre-wrap">${escapeHtml(requirements ?? '—')}</td>
          </tr>
        </table>
        <p style="margin-top:24px;color:#6b7280;font-size:13px">
          Submitted via Vendbase Pricing page
        </p>
      </div>
    `;

    const text = [
      'New Enterprise Inquiry',
      `Name: ${name}`,
      `Store / Business: ${storeName}`,
      `Phone: ${phone}`,
      `Requirements: ${requirements ?? '—'}`,
    ].join('\n');

    const recipient = config.ADMIN_NOTIFY_EMAIL;

    if (!recipient) {
      // No hardcoded fallback: emailing a personal address baked into the source
      // would leak this deployment's sales leads to a third party. Record the
      // enquiry at WARN so the operator can still recover it from the logs.
      logger.warn('contactSales: ADMIN_NOTIFY_EMAIL is not configured — enquiry NOT emailed', {
        name, storeName, phone, requirements: requirements ?? '',
      });
    } else {
      await emailService.sendEmail({
        to: recipient,
        subject: `Enterprise Inquiry — ${name} (${storeName})`,
        html,
        text,
      });
      logger.info('contactSales: inquiry forwarded', { name, storeName });
    }

    res.status(200).json({ success: true, message: 'Request sent. We\'ll reach out within 24 hours.' });
  } catch (err) {
    logger.error('contactSales: failed to send inquiry email', { error: err });
    next(err);
  }
}
