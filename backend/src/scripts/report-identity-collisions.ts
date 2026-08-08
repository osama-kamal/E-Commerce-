/**
 * report-identity-collisions.ts
 *
 * READ-ONLY. Writes nothing, ever.
 *
 * Reports every email address holding accounts in more than one store, and what
 * changes for each once login becomes strictly store-scoped.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 * The unique index on users is `{ storeId, email }`, so the same address may
 * legitimately hold several accounts — a shopper at two unrelated shops, or a
 * merchant who also buys from someone else's store.
 *
 * Login did not honour that. `authRoutes` is mounted at `/api/v1/auth` BEFORE
 * the tenant router, so Express never reached the store-scoped mount and
 * `req.store` was always undefined. Every login therefore fell through to a
 * global lookup that picked by email alone — preferring any super-admin, then
 * any admin, then the oldest account of any role.
 *
 * Two consequences, both visible below:
 *   • ESCALATION  — a shopper's password on store A could authenticate an admin
 *     account belonging to store B.
 *   • LOCKOUT     — more common. A customer whose email collides with any older
 *     or more privileged account could not reach their own account at all,
 *     because only the other account's password was ever compared.
 *
 * Run this before switching login over, so the human impact is a known number
 * rather than a surprise.
 *
 *   cd backend && npm run report:identity-collisions
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

interface AccountRow {
  _id: mongoose.Types.ObjectId;
  storeId: mongoose.Types.ObjectId;
  email: string;
  role: string;
  isActive: boolean;
  createdAt?: Date;
}

const RANK: Record<string, number> = { 'super-admin': 0, admin: 1, customer: 2 };

/**
 * Which account today's global resolution reaches for an address.
 *
 * Mirrors the old `auth.service.login` fallback chain: first super-admin, then
 * admin, then any role — each sorted oldest-first.
 */
function currentlyReachable(accounts: AccountRow[]): AccountRow {
  return [...accounts].sort((a, b) => {
    const byRole = (RANK[a.role] ?? 9) - (RANK[b.role] ?? 9);
    if (byRole !== 0) return byRole;
    return (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);
  })[0];
}

async function run(): Promise<void> {
  const uri =
    process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ecommerce';
  console.log(`Connecting to ${uri.replace(/:([^@]+)@/, ':***@')} …`);
  await mongoose.connect(uri);
  console.log('Connected.\n');

  const users = mongoose.connection.collection('users');
  const stores = mongoose.connection.collection('stores');

  const totalUsers = await users.countDocuments({});

  const grouped = await users
    .aggregate<{ _id: string; accounts: AccountRow[] }>([
      { $match: { email: { $type: 'string' } } },
      {
        $group: {
          _id: '$email',
          accounts: {
            $push: {
              _id: '$_id',
              storeId: '$storeId',
              email: '$email',
              role: '$role',
              isActive: '$isActive',
              createdAt: '$createdAt',
            },
          },
        },
      },
      { $match: { 'accounts.1': { $exists: true } } }, // more than one account
      { $sort: { _id: 1 } },
    ])
    .toArray();

  const storeNames = new Map<string, string>();
  for (const store of await stores.find({}, { projection: { name: 1 } }).toArray()) {
    storeNames.set(store._id.toString(), (store.name as string) ?? '(unnamed)');
  }
  const nameOf = (id: mongoose.Types.ObjectId) =>
    storeNames.get(id.toString()) ?? '(store missing)';

  console.log(`Users total:                     ${totalUsers}`);
  console.log(`Emails with >1 account:          ${grouped.length}\n`);

  if (grouped.length === 0) {
    console.log('✅ No collisions. Strict per-store login changes nothing for anyone.');
    return;
  }

  let unlocked = 0;      // accounts that become reachable
  let mustMove = 0;      // merchants who must switch to platform login
  let duplicateAdmins = 0;

  for (const { _id: email, accounts } of grouped) {
    const winner = currentlyReachable(accounts);
    const admins = accounts.filter(a => a.role === 'admin' || a.role === 'super-admin');

    console.log(`── ${email}`);
    for (const acct of accounts) {
      const reachable = acct._id.toString() === winner._id.toString();
      const marker = reachable ? 'REACHABLE TODAY' : 'SHADOWED';
      const flags = [
        acct.role,
        acct.isActive === false ? 'inactive' : null,
      ].filter(Boolean).join(', ');
      console.log(
        `     ${reachable ? '>' : ' '} ${marker.padEnd(16)} ${nameOf(acct.storeId).padEnd(24)} (${flags})`
      );
      if (!reachable) unlocked++;
    }

    if (admins.length > 1) {
      duplicateAdmins++;
      console.log(`     ⚠️  ${admins.length} privileged accounts share this address — see repair:owners`);
    }
    if (winner.role !== 'customer') {
      mustMove++;
      console.log(`     → after the change, this address signs in at the PLATFORM login for store admin`);
    }
    console.log('');
  }

  console.log('── Summary ──────────────────────────────────────────────────────');
  console.log(`Accounts currently shadowed and unreachable:  ${unlocked}`);
  console.log(`  These REGAIN access to their own store once login is scoped.`);
  console.log(`  If the owner only ever knew the other account's password, they`);
  console.log(`  use the storefront's forgot-password flow, which is already`);
  console.log(`  store-scoped and unaffected.\n`);
  console.log(`Addresses resolving to a privileged account:  ${mustMove}`);
  console.log(`  These must sign in at the platform host to manage their store,`);
  console.log(`  instead of through a storefront URL.\n`);
  console.log(`Addresses with duplicate privileged accounts: ${duplicateAdmins}`);
  if (duplicateAdmins > 0) {
    console.log(`  Run \`npm run repair:owners\` first — it consolidates store`);
    console.log(`  ownership onto one account and is safe to dry-run.\n`);
  }
}

run()
  .catch((err) => {
    console.error('\n❌ Report failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
    console.log('Disconnected.');
  });
