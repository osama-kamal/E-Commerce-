/**
 * Escapes a value for safe interpolation into HTML text or a quoted attribute.
 *
 * Transactional email bodies are assembled with template literals, and
 * user-controlled values were interpolated raw:
 *
 *   - `branding.storeName` is set by the store owner and appears in the header,
 *     footer and subject of every email that store sends to its customers.
 *   - `storeName` / `ownerEmail` appear in the plan-upgrade request email that
 *     goes to the PLATFORM operator — so one tenant could inject markup into the
 *     platform owner's inbox (a working phishing link, a fake "approve" button,
 *     or a tracking pixel).
 *   - product names and shipping addresses appear in order confirmations.
 *
 * Note the existing `safe()` helper in email.templates.ts is a null/undefined
 * fallback, NOT an escaper — it returns String(value) untouched.
 *
 * Escaping `"` and `'` matters because values are also placed inside quoted
 * attributes such as `<img src="...">`.
 */
export function escapeHtml(value: unknown): string {
  if (value === undefined || value === null) return '';

  return String(value)
    .replace(/&/g, '&amp;')   // must be first
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
