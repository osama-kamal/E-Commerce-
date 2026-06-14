import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IRefreshToken {
  token: string;       // bcrypt hash of the raw token
  expiresAt: Date;
}

export interface IUser extends Document {
  storeId: Types.ObjectId;
  email: string;
  passwordHash: string;
  role: 'super-admin' | 'admin' | 'customer';
  isActive: boolean;
  refreshTokens: IRefreshToken[];
  passwordResetToken?: string;   // SHA-256 hash
  passwordResetExpires?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    token: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { _id: false }
);

const userSchema = new Schema<IUser>(
  {
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ['super-admin', 'admin', 'customer'],
      default: 'customer',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    refreshTokens: {
      type: [refreshTokenSchema],
      default: [],
    },
    passwordResetToken: {
      type: String,
      default: undefined,
    },
    passwordResetExpires: {
      type: Date,
      default: undefined,
    },
  },
  {
    timestamps: true,
  }
);

// Email is unique per store (not globally)
userSchema.index({ storeId: 1, email: 1 }, { unique: true });

// Never expose passwordHash or refreshTokens in JSON responses
userSchema.set('toJSON', {
  transform(_doc, ret: any) {
    delete ret.passwordHash;
    delete ret.refreshTokens;
    delete ret.passwordResetToken;
    delete ret.passwordResetExpires;
    return ret;
  },
});

export const User = mongoose.model<IUser>('User', userSchema);
