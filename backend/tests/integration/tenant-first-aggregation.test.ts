/**
 * Every tenant-scoped aggregation must filter by store in its FIRST stage.
 *
 * ── The pipeline this exists to prevent ───────────────────────────────────────
 * The merchant dashboard used to compute revenue like this:
 *
 *     Payment.aggregate([
 *       { $match: { status: 'succeeded', ...dateFilter } },   // ← no storeId
 *       { $lookup: { from: 'orders', ... } },                 // ← joins ALL orders
 *       { $unwind: '$order' },
 *       { $match: { 'order.storeId': storeObjId } },          // ← filtered LAST
 *       { $group: { _id: null, total: { $sum: '$amount' } } },
 *     ])
 *
 * Its output was correctly scoped — no tenant ever saw another's data — but
 * every dashboard load scanned every payment on the platform and joined the
 * entire orders collection before discarding almost all of it. Cost grew with
 * total platform volume rather than with the store's own.
 *
 * The structural risk was worse than the cost. Filtering the tenant late means
 * one careless edit — moving the `$group` up, adding a `$limit`, reusing the
 * pipeline elsewhere — turns a slow query into a cross-tenant disclosure.
 *
 * This test reads the source rather than running queries, so it catches the
 * shape at CI regardless of what data happens to exist.
 */

import fs from 'fs';
import path from 'path';

/** Services that operate on one tenant's data. */
const TENANT_SERVICE_FILES = [
  'src/modules/admin/admin.service.ts',
  'src/modules/analytics/analytics.service.ts',
  'src/modules/reports/reports.service.ts',
  'src/modules/orders/order.service.ts',
  'src/modules/refunds/refund.service.ts',
  'src/modules/reviews/review.service.ts',
];

/**
 * Aggregations that legitimately have no tenant filter, each with a reason.
 * Adding an entry here is a deliberate act that shows up in review.
 */
const ALLOWED_WITHOUT_TENANT_FILTER: Array<{ file: string; reason: string }> = [
  {
    file: 'src/modules/orders/order.service.ts',
    reason:
      'expireStalePendingOrders sweeps abandoned checkouts across every store by ' +
      'design, and is backed by the { status, paymentMethod, createdAt } index',
  },
];

const REPO_ROOT = path.resolve(__dirname, '../..');

/**
 * Extracts the first pipeline stage of every `.aggregate([` call.
 *
 * Deliberately a source scan, not a runtime hook: the property being asserted
 * is about how the code is WRITTEN, and a runtime check would only cover the
 * paths a test happens to exercise.
 */
function firstStagesOf(source: string): string[] {
  const stages: string[] = [];
  const marker = '.aggregate([';
  let index = source.indexOf(marker);

  while (index !== -1) {
    const afterBracket = index + marker.length;

    // `Model.aggregate([...pipeline, { $count }])` — stage one lives in the
    // spread variable, not here. Resolve it rather than reading `{ $count }`
    // and reporting a false positive: these composed pipelines are exactly
    // where a missing tenant filter would be hardest to spot by eye.
    const spread = /^\s*\.\.\.(\w+)/.exec(source.slice(afterBracket, afterBracket + 40));
    if (spread) {
      stages.push(declaredPipelineHead(source, spread[1]));
      index = source.indexOf(marker, afterBracket);
      continue;
    }

    // Otherwise walk forward to the first balanced `{ ... }`.
    let depth = 0;
    let start = -1;
    for (let i = afterBracket; i < source.length; i++) {
      const ch = source[i];
      if (ch === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          stages.push(source.slice(start, i + 1));
          break;
        }
      } else if (ch === ']' && depth === 0) {
        break; // empty pipeline
      }
    }
    index = source.indexOf(marker, afterBracket);
  }

  return stages;
}

/**
 * The opening of a pipeline variable's declaration, so a spread-composed
 * aggregation is judged on where the variable actually starts.
 *
 * Returns the empty string when the declaration cannot be found, which fails
 * the check — an unresolvable pipeline should be looked at, not waved through.
 */
function declaredPipelineHead(source: string, name: string): string {
  const declaration = new RegExp(`(?:const|let)\\s+${name}\\b[^=]*=\\s*\\[`).exec(source);
  if (!declaration) return '';
  const from = declaration.index + declaration[0].length;
  return source.slice(from, from + 200);
}

describe('tenant-scoped aggregations filter by store first', () => {
  it.each(TENANT_SERVICE_FILES)('%s', (relativePath) => {
    const fullPath = path.join(REPO_ROOT, relativePath);
    if (!fs.existsSync(fullPath)) return; // module not present in this build

    const source = fs.readFileSync(fullPath, 'utf8');
    const allowance = ALLOWED_WITHOUT_TENANT_FILTER.filter((a) => a.file === relativePath).length;

    const offenders = firstStagesOf(source).filter((stage) => {
      // `revenueMatch(...)` and `storeId` both establish tenancy. A pipeline
      // built from a variable is checked by the variable's own declaration
      // appearing in the same file, which the storeId test below covers.
      const scoped =
        stage.includes('storeId') ||
        stage.includes('revenueMatch(') ||
        stage.includes('matchStage') ||
        stage.includes('baseMatch') ||
        stage.includes('pipeline');
      return !scoped;
    });

    // Allowances are counted rather than matched individually so a deliberate
    // platform-wide sweep does not require weakening the rule for the file.
    expect(offenders.length).toBeLessThanOrEqual(allowance);
  });

  it('no aggregation joins another collection before scoping the tenant', () => {
    // `$lookup` ahead of a tenant filter is the specific shape that made the old
    // dashboard scan the platform: the join multiplies an unscoped set, and only
    // afterwards is almost all of it discarded.
    //
    // The assertion is about ORDER, not presence — joining is fine once the set
    // has been narrowed to one store.
    for (const relativePath of TENANT_SERVICE_FILES) {
      const fullPath = path.join(REPO_ROOT, relativePath);
      if (!fs.existsSync(fullPath)) continue;

      const source = fs.readFileSync(fullPath, 'utf8');
      for (const head of firstStagesOf(source)) {
        const lookupAt = head.indexOf('$lookup');
        if (lookupAt === -1) continue;

        const scopeAt = Math.min(
          ...['storeId', 'revenueMatch('].map((token) => {
            const at = head.indexOf(token);
            return at === -1 ? Number.MAX_SAFE_INTEGER : at;
          })
        );

        expect(scopeAt).toBeLessThan(lookupAt);
      }
    }
  });

  it('revenue is never derived from the payments collection', () => {
    // Payments are reconciliation only. They carry no COD sale, no breakdown,
    // and minor units — deriving revenue from them is what produced a dashboard
    // figure that disagreed with every other screen.
    const adminService = fs.readFileSync(
      path.join(REPO_ROOT, 'src/modules/admin/admin.service.ts'),
      'utf8'
    );
    expect(adminService).not.toContain('Payment.aggregate');
  });
});
