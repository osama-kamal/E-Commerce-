/**
 * Trust check for messages arriving from the Paymob payment iframe.
 *
 * The checkout previously accepted any message whose origin merely CONTAINED
 * the string "paymob.com":
 *
 *     if (!event.origin.includes('paymob.com')) return;
 *
 * That is a substring test on a full origin, so it also matches attacker-owned
 * hosts such as `https://paymob.com.evil.io` or `http://paymob.com.attacker.net`.
 * Any page able to post a message could then trigger the success handler and
 * drive the customer to the "Payment Successful" screen without a payment.
 *
 * Origins are now parsed and matched on the hostname, and HTTPS is required.
 */

/** Exact hosts Paymob serves checkout from. */
const TRUSTED_HOSTS = new Set([
  'paymob.com',
  'accept.paymob.com',
  'paymobsolutions.com',
  'accept.paymobsolutions.com',
]);

/** Apex domains whose subdomains are trusted (regional: uae., ksa., pakistan., …). */
const TRUSTED_SUFFIXES = ['.paymob.com', '.paymobsolutions.com'];

export function isTrustedPaymobOrigin(origin: string | undefined | null): boolean {
  if (!origin) return false;

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false; // not a parseable origin
  }

  // Payment data must never be trusted over plaintext.
  if (url.protocol !== 'https:') return false;

  const host = url.hostname.toLowerCase();

  if (TRUSTED_HOSTS.has(host)) return true;

  // endsWith on a dot-prefixed suffix is what makes this safe:
  //   'paymob.com.evil.io'.endsWith('.paymob.com') === false
  //   'evil-paymob.com'.endsWith('.paymob.com')    === false
  //   'uae.paymob.com'.endsWith('.paymob.com')     === true
  return TRUSTED_SUFFIXES.some((suffix) => host.endsWith(suffix));
}
