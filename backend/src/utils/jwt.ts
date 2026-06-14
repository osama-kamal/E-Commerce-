import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { config } from '../config/index';

export interface JwtPayload {
  userId: string;
  role: 'super-admin' | 'admin' | 'customer';
  storeId: string;
}

/**
 * Sign a short-lived access token (15 min by default).
 * The role and storeId are embedded so every authenticated request carries
 * both tenant context and permission level.
 */
export function signAccessToken(
  userId: Types.ObjectId,
  role: 'super-admin' | 'admin' | 'customer',
  storeId: string
): string {
  return jwt.sign(
    { userId: userId.toString(), role, storeId },
    config.JWT_ACCESS_SECRET,
    { expiresIn: config.JWT_ACCESS_EXPIRY as jwt.SignOptions['expiresIn'] }
  );
}

/**
 * Verify and decode an access token. Throws if invalid or expired.
 */
export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, config.JWT_ACCESS_SECRET) as JwtPayload;
}
