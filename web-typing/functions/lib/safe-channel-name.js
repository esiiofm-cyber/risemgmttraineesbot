/**
 * Discord channel names: lowercase alphanumerics + hyphens, max 100 chars.
 */
export function sanitizeDiscordChannelSlug(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Prefer ticket-{username}; fall back to ticket-{last digits of snowflake} when missing/empty.
 */
export function safeResultsChannelName(uid, usernameHint) {
  const raw = typeof usernameHint === 'string' ? usernameHint.trim() : '';
  const slug = sanitizeDiscordChannelSlug(raw);
  if (slug) {
    return `ticket-${slug}`.slice(0, 100);
  }
  const u = String(uid).replace(/\D/g, '').slice(-12) || 'applicant';
  return `ticket-${u}`.slice(0, 100);
}
