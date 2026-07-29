/**
 * reset-password.ts
 *
 * Resets the password for a specific user by email.
 * Connects to the DB, finds the user, bcrypt-hashes the new password,
 * and updates passwordHash + clears any stale refresh tokens.
 *
 * Usage:
 *   cd backend
 *   npx ts-node src/scripts/reset-password.ts
 *
 * Edit TARGET_EMAIL and NEW_PASSWORD below before running.
 */

import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// ── Input ──────────────────────────────────────────────────────────────────
// Supplied at run time, NEVER hardcoded. This file previously contained a real
// administrator's email and their plaintext password as source constants, which
// were then committed to the repository — a live credential in version control.
//
//   npx ts-node src/scripts/reset-password.ts <email> <newPassword>
//
// or via environment:
//   RESET_EMAIL=... RESET_PASSWORD=... npx ts-node src/scripts/reset-password.ts
const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

const TARGET_EMAIL = process.argv[2] ?? process.env.RESET_EMAIL ?? '';
const NEW_PASSWORD = process.argv[3] ?? process.env.RESET_PASSWORD ?? '';
// ───────────────────────────────────────────────────────────────────────────

function usage(message: string): never {
  console.error(`❌ ${message}\n`);
  console.error('Usage:');
  console.error('  npx ts-node src/scripts/reset-password.ts <email> <newPassword>');
  console.error('  RESET_EMAIL=<email> RESET_PASSWORD=<pw> npx ts-node src/scripts/reset-password.ts\n');
  process.exit(1);
}

async function run() {
  if (!TARGET_EMAIL) usage('No target email supplied.');
  if (!NEW_PASSWORD) usage('No new password supplied.');
  if (NEW_PASSWORD.length < MIN_PASSWORD_LENGTH) {
    usage(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ecommerce';
  console.log(`Connecting to ${uri} …`);
  await mongoose.connect(uri);
  console.log('Connected.\n');

  const users = mongoose.connection.collection('users');

  // Find the user
  const user = await users.findOne({ email: TARGET_EMAIL.toLowerCase() });
  if (!user) {
    console.error(`❌ No user found with email: ${TARGET_EMAIL}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`Found user:`);
  console.log(`  _id:   ${user._id}`);
  console.log(`  email: ${user.email}`);
  console.log(`  role:  ${user.role}`);
  console.log(`  storeId: ${user.storeId}\n`);

  // Hash the new password
  console.log(`Hashing new password …`);
  const passwordHash = await bcrypt.hash(NEW_PASSWORD, BCRYPT_ROUNDS);

  // Update: new hash, clear refresh tokens, clear any password reset tokens
  const result = await users.updateOne(
    { _id: user._id },
    {
      $set: {
        passwordHash,
        refreshTokens: [],
      },
      $unset: {
        passwordResetToken: '',
        passwordResetExpires: '',
      },
    }
  );

  if (result.modifiedCount === 1) {
    console.log(`✅ Password updated successfully for ${TARGET_EMAIL}`);
    console.log(`\nYou can now log in with:`);
    console.log(`  Email:    ${TARGET_EMAIL}`);
    console.log(`  Password: ${NEW_PASSWORD}`);
    console.log(`\n⚠️  Change this password immediately after logging in.`);
  } else {
    console.error('❌ Update did not modify any document. Check the email.');
  }

  await mongoose.disconnect();
  console.log('\nDisconnected.');
}

run().catch(err => {
  console.error('Script failed:', err);
  mongoose.disconnect();
  process.exit(1);
});
