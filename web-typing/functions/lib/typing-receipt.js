import { b64UrlToJson } from './verify-token.js';

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const RECEIPT_KEYS = ['v', 'exp', 'uid', 'cid', 'gid', 'roundProof', 'wpmR', 'accR', 'elR', 'perW', 'perA', 'exact'];

function receiptPayloadToB64(payload) {
  const body = JSON.stringify(payload, RECEIPT_KEYS);
  const bytes = new TextEncoder().encode(body);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function signTypingReceipt(secret, data) {
  const payload = {
    v: 1,
    exp: data.exp,
    uid: String(data.uid),
    cid: String(data.cid),
    gid: String(data.gid),
    roundProof: String(data.roundProof),
    wpmR: data.wpmR,
    accR: data.accR,
    elR: data.elR,
    perW: data.perW,
    perA: data.perA,
    exact: data.exact ? 1 : 0,
  };
  const b64 = receiptPayloadToB64(payload);
  const hex = await hmacSha256Hex(secret, b64);
  return `${b64}.${hex}`;
}

export async function verifyTypingReceiptDetailed(secret, receiptStr, tokenPayload) {
  secret = typeof secret === 'string' ? secret.trim() : '';
  if (!receiptStr || !secret) return { ok: false, reason: 'no_receipt_or_secret' };
  const parts = receiptStr.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'bad_receipt_format' };
  const [b64, sig] = parts;
  const hex = await hmacSha256Hex(secret, b64);
  if (hex !== sig) return { ok: false, reason: 'receipt_sig_mismatch' };
  let payload;
  try {
    payload = b64UrlToJson(b64);
  } catch {
    return { ok: false, reason: 'bad_receipt_payload' };
  }
  if (payload.v !== 1) return { ok: false, reason: 'bad_receipt_version' };
  if (payload.exp !== tokenPayload.exp) return { ok: false, reason: 'receipt_exp_mismatch' };
  if (String(payload.uid) !== String(tokenPayload.uid)) return { ok: false, reason: 'receipt_uid_mismatch' };
  if (String(payload.cid) !== String(tokenPayload.cid)) return { ok: false, reason: 'receipt_cid_mismatch' };
  if (String(payload.gid) !== String(tokenPayload.gid)) return { ok: false, reason: 'receipt_gid_mismatch' };
  if (typeof payload.roundProof !== 'string' || !payload.roundProof) return { ok: false, reason: 'no_round_proof' };
  if (!Array.isArray(payload.perW) || !Array.isArray(payload.perA)) return { ok: false, reason: 'bad_per_arrays' };
  return { ok: true, payload };
}
