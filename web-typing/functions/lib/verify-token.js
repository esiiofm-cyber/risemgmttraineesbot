export function b64UrlToJson(b64url) {
  const pad = (4 - (b64url.length % 4)) % 4;
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  const bin = atob(b64);
  return JSON.parse(bin);
}

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifySignedTokenDetailed(token, secret) {
  secret = typeof secret === 'string' ? secret.trim() : '';
  if (!token || !secret) return { ok: false, reason: 'no_token_or_secret' };
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'bad_format' };
  const [b64, sig] = parts;
  const hex = await hmacSha256Hex(secret, b64);
  if (hex !== sig) return { ok: false, reason: 'sig_mismatch' };
  let payload;
  try {
    payload = b64UrlToJson(b64);
  } catch {
    return { ok: false, reason: 'bad_payload' };
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) return { ok: false, reason: 'expired' };
  if (payload.v !== 1) return { ok: false, reason: 'bad_version' };
  if (!Array.isArray(payload.idx) || payload.idx.length < 1) return { ok: false, reason: 'bad_idx' };
  for (const k of ['cid', 'uid', 'gid']) {
    const v = payload[k];
    if (typeof v === 'string' && /^\d+$/.test(v)) continue;
    if (typeof v === 'number' && Number.isSafeInteger(v)) {
      payload[k] = String(v);
      continue;
    }
    if (typeof v === 'number') {
      return { ok: false, reason: 'snowflake_precision' };
    }
    return { ok: false, reason: 'bad_snowflake' };
  }
  return { ok: true, payload };
}

export async function verifySignedToken(token, secret) {
  const r = await verifySignedTokenDetailed(token, secret);
  return r.ok ? r.payload : null;
}
