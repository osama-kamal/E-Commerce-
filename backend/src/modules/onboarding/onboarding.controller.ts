import { Request, Response, NextFunction } from 'express';
import { onboardStore } from './onboarding.service';
import { sendSuccess } from '../../utils/response';

export async function handleOnboarding(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await onboardStore(req.body);
    sendSuccess(res, result, 201);
  } catch (err) {
    next(err);
  }
}
