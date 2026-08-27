/**
 * A fake `@/lib/email` for scripts/check-webhook.mjs. Records what would have
 * been sent, so the assertions can read the body a customer would receive.
 */

export const sent = [];

export function resetEmail() {
  sent.length = 0;
}

export function isEmailConfigured() {
  return true;
}

export function maskEmail(address) {
  return String(address).replace(/^(.).*@/, "$1***@");
}

export async function sendEmail(message) {
  sent.push(message);
  return { ok: true };
}
