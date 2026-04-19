export function getWebTypingSecret(env) {
  const v = env && env.WEB_TYPING_SHARED_SECRET;
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  return String(v).trim();
}
