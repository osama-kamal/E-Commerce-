import { Types } from 'mongoose';
import { NewsletterSubscriber } from './newsletter.model';
import { emailService } from '../../services/email.service';
import { logger } from '../../utils/logger';

export const newsletterService = {
  async subscribe(storeId: string, email: string) {
    const existing = await NewsletterSubscriber.findOne({
      storeId: new Types.ObjectId(storeId),
      email,
    });

    if (existing) {
      if (existing.isActive) {
        return { message: 'You are already subscribed!', subscriber: existing };
      }
      existing.isActive = true;
      existing.subscribedAt = new Date();
      existing.unsubscribedAt = undefined;
      await existing.save();
      return { message: 'Welcome back! Your subscription has been reactivated.', subscriber: existing };
    }

    const subscriber = await NewsletterSubscriber.create({
      storeId: new Types.ObjectId(storeId),
      email,
    });
    return { message: 'Successfully subscribed to our newsletter!', subscriber };
  },

  async unsubscribe(storeId: string, email: string) {
    const subscriber = await NewsletterSubscriber.findOne({
      storeId: new Types.ObjectId(storeId),
      email,
    });

    if (!subscriber) throw new Error('Email not found in our newsletter list');
    if (!subscriber.isActive) throw new Error('You are already unsubscribed');

    subscriber.isActive = false;
    subscriber.unsubscribedAt = new Date();
    await subscriber.save();

    return { message: 'Successfully unsubscribed from our newsletter', subscriber };
  },

  async getAllSubscribers(storeId: string, activeOnly = true) {
    const filter: any = { storeId: new Types.ObjectId(storeId) };
    if (activeOnly) filter.isActive = true;
    return NewsletterSubscriber.find(filter).sort({ subscribedAt: -1 });
  },

  async getSubscriberCount(storeId: string) {
    const storeObjId = new Types.ObjectId(storeId);
    const total = await NewsletterSubscriber.countDocuments({ storeId: storeObjId });
    const active = await NewsletterSubscriber.countDocuments({ storeId: storeObjId, isActive: true });
    return { total, active, inactive: total - active };
  },

  async sendNewsletter(storeId: string, subject: string, message: string): Promise<{ sent: number; failed: number }> {
    const activeSubscribers = await NewsletterSubscriber.find({
      storeId: new Types.ObjectId(storeId),
      isActive: true,
    }).lean();

    if (activeSubscribers.length === 0) return { sent: 0, failed: 0 };

    let sent = 0;
    let failed = 0;

    for (const subscriber of activeSubscribers) {
      try {
        const html = `
          <!DOCTYPE html>
          <html>
          <head><meta charset="UTF-8"/></head>
          <body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
            <div style="max-width:600px;margin:30px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
              <div style="background:#1a1a2e;padding:24px 32px;text-align:center;">
                <h1 style="margin:0;color:#fff;font-size:22px;">Newsletter</h1>
              </div>
              <div style="padding:32px;">
                <h2 style="color:#1a1a2e;">${subject}</h2>
                <div style="color:#444;line-height:1.7;white-space:pre-wrap;">${message}</div>
              </div>
              <div style="background:#f4f4f4;padding:16px 32px;text-align:center;font-size:12px;color:#888;border-top:1px solid #e0e0e0;">
                &copy; ${new Date().getFullYear()} All rights reserved.<br/>
                You received this because you subscribed to our newsletter.
              </div>
            </div>
          </body>
          </html>
        `;
        const text = `${subject}\n\n${message}`;

        await emailService.sendEmail({ to: subscriber.email, subject, html, text });
        sent++;
      } catch (err) {
        logger.error('Failed to send newsletter to subscriber', { email: subscriber.email, error: err });
        failed++;
      }
    }

    logger.info(`Newsletter sent: ${sent} succeeded, ${failed} failed`);
    return { sent, failed };
  },
};
