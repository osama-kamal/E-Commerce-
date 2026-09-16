# Disaster recovery — backup, restore, rollback

What to do when the database is wrong, and how to know the fix worked.

This covers the **data**. For rolling back application code see [§5](#5-rolling-back-a-bad-deploy).

> **Status of this document.** The restore *verification* is automated and
> tested (`npm run verify:restore`, pinned by
> `backend/tests/integration/restore-verification.test.ts`). The Atlas
> configuration in §1 has **not** been verified against your cluster — nobody
> has confirmed backups are actually enabled. [§7](#7-before-you-launch) is the
> checklist that closes that gap, and it must be done by hand, once, before
> launch.

---

## 1. What backups exist

Atlas backup is a **per-cluster setting that is off on M0/M2/M5 shared tiers**.
If you are on a shared tier today, you have no backups at all and nothing in
this document will save you. That is the first thing to check.

| Tier | Backup available | What you get |
|---|---|---|
| M0 / M2 / M5 (shared) | ❌ none | nothing — export manually or upgrade |
| M10+ (dedicated) | ✅ Cloud Backup | scheduled snapshots + point-in-time recovery |

**Recommended policy for M10+** (Atlas → Cluster → Backup → Edit Policy):

| Snapshot | Frequency | Retain |
|---|---|---|
| Hourly | every 6 h | 2 days |
| Daily | 1×/day | 7 days |
| Weekly | 1×/week | 4 weeks |
| Monthly | 1×/month | 12 months |

Enable **Continuous Cloud Backup** (PITR) as well. Snapshots alone mean an
incident at 05:59 loses up to six hours; PITR narrows the recovery point to the
minute and is what makes §4 possible.

**Resulting objectives** — write these down and hold the platform to them:

- **RPO** (data you can afford to lose): ~1 minute with PITR, up to 6 h without
- **RTO** (time to be serving again): 30–60 min for a full cluster restore

`npm run verify:restore` reports the RPO you *actually* achieved, rather than
the one the schedule implies. See [§6](#6-verifying-a-restore).

---

## 2. Manual export (works on any tier)

Requires [MongoDB Database Tools](https://www.mongodb.com/try/download/database-tools)
— `mongodump` is **not** bundled with the MongoDB server and is not currently
installed on the dev machine.

```bash
mongodump --uri="$MONGODB_URI" --gzip --archive=backup-$(date +%Y%m%d-%H%M).gz
```

Restore into a **new** database, never over a live one:

```bash
mongorestore --uri="$MONGODB_URI" --gzip --archive=backup-20260808-1430.gz --nsFrom='ecommerce.*' --nsTo='ecommerce_restored.*'
```

> ⚠️ Never pass `--noIndexRestore`. It completes faster and leaves the unique
> indexes off, which silently removes tenant isolation — `{storeId, email}` is
> what stops one shop's customer colliding with another's. §6 checks for this
> explicitly because it is invisible otherwise.

An M0-tier fallback is a scheduled job running the `mongodump` above to
S3/Backblaze. It is worse than Atlas backup in every way (no PITR, manual
restore, you own the retention) and is a reason to be on M10, not a substitute.

---

## 3. Restoring a snapshot

**Atlas → Cluster → Backup → Snapshots → Restore.**

Always restore to a **new cluster or a new database name** first. Restoring in
place destroys the evidence of whatever went wrong, and if the snapshot turns
out to be bad you have no second attempt.

1. Pick the snapshot **immediately before** the incident began
2. Restore target: a new cluster (`ecommerce-restore-YYYYMMDD`)
3. Wait for the restore to reach *Completed*
4. **Run [§6](#6-verifying-a-restore) against the restored cluster** — do not skip
5. Point `MONGODB_URI` at it (Railway → Variables), redeploy
6. Keep the damaged cluster untouched for at least 7 days

---

## 4. Point-in-time recovery

For "a bad migration ran at 14:32 and we noticed at 14:51".

**Atlas → Cluster → Backup → Point in Time Restore**, target a timestamp
**one minute before** the damaging write. Then follow §3 from step 3.

Getting the timestamp right matters more than getting it early: too late and you
restore the damage, too early and you discard good orders. `backend/logs/` and
the Sentry issue timeline are how you find the minute — Sentry records the first
occurrence of an error, which is usually the tightest bound you have.

---

## 5. Rolling back a bad deploy

Code and data roll back **separately**, and the order matters.

### Code only (no migration ran)

Railway → Deployments → the last good deploy → **Redeploy**. ~2 minutes, no data
implications. Vercel has the same via **Promote to Production** on a previous
deployment.

### Code plus a migration

The migration scripts in `backend/src/scripts/` are **not** transactional and
have **no down-migrations**. Rolling back code does not undo them. Two of them
write their own rollback files, which is the only reason those cases are
recoverable:

| Script | Rollback |
|---|---|
| `repair:owners` | writes `owner-consolidation-rollback-*.json` |
| `repair:store-owner` | writes `rollback-store-owner-*.json` (contains a ready-to-run `updateOne`) |
| `migrate:*` backfills | **none** — recover via §4 |

So: for a backfill, PITR to just before it ran. There is no faster path, which
is the argument for taking a manual snapshot immediately before any migration.

---

## 6. Verifying a restore

```bash
MONGODB_URI="mongodb+srv://…/restored-db" npm run verify:restore
```

Read-only and safe against production. Exits non-zero if anything failed.

It checks the things a human assumes and a restore quietly breaks:

| Check | Why it is not obvious |
|---|---|
| Collections populated | a "successful" restore against the wrong/empty cluster looks identical to a real one |
| Unique indexes present **and unique** | `--noIndexRestore` leaves data intact and tenant isolation gone |
| Referential integrity | orders→stores, orders→users, products→stores, stores→owners, payments→orders, refunds→orders |
| `refundedTotal ≤ totalAmount` | a partial oplog replay breaks the refund reservation, and the order will refund the same money twice |
| No negative totals or stock | interleaved snapshots |
| Newest order timestamp | the RPO you actually achieved, stated in minutes, rather than assumed |

Failures print as `DO NOT send production traffic to this database`. Freshness is
a warning, not a failure — only you know the intended recovery point.

The verifier is itself tested: `restore-verification.test.ts` breaks a database
in seven realistic ways (missing index, orphaned order, orphaned store owner,
over-refunded order, negative total, empty target, users dropped) and asserts
each is caught. A verifier that only ever prints ✅ converts "we did not check"
into "we checked and it was fine".

---

## 7. Before you launch

Nobody has confirmed any of this against the real cluster. Do it once, in order.

- [ ] Confirm the cluster is **M10+** — on a shared tier, stop here and upgrade
- [ ] Enable **Cloud Backup** and set the policy in §1
- [ ] Enable **Continuous Cloud Backup** (PITR)
- [ ] Confirm a snapshot has actually been taken (Backup → Snapshots is non-empty)
- [ ] **Run a full restore drill** into a scratch cluster and time it — this is
      the only step that proves any of the above, and the measured duration is
      your real RTO
- [ ] Run `npm run verify:restore` against the drill cluster; confirm it passes
- [ ] Deliberately break the drill cluster (`db.users.dropIndex('storeId_1_email_1')`)
      and confirm the verifier **fails** — proving it would catch a bad restore
- [ ] Delete the scratch cluster
- [ ] Record who has Atlas restore permissions, and check it is more than one person

Until the drill is done, treat the RTO in §1 as a guess.

---

## 8. Incident quick reference

| Situation | Go to |
|---|---|
| Bad deploy, no migration | §5 — Railway redeploy, ~2 min |
| Bad migration | §4 — PITR to just before it ran |
| Data corrupted, time unknown | §3 — restore last known-good snapshot |
| Cluster unreachable | Atlas status, then §3 into a new cluster |
| Accidental collection drop | §4 — PITR to one minute before |

**Every path ends at §6.** A restore is not finished when Atlas says
*Completed*; it is finished when the verifier passes.
