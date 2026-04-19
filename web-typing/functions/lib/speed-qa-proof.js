import { b64UrlToJson } from './verify-token.js';

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function jsonToB64Url(payload) {
  const keys = ['cid', 'exp', 'idx', 'kind', 'uid', 'v'];
  const body = JSON.stringify(payload, keys);
  const bytes = new TextEncoder().encode(body);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function signSpeedQaProof(secret, p) {
  const payload = {
    v: 1,
    cid: String(p.cid),
    exp: p.exp,
    idx: p.idx,
    kind: 'speed_qa',
    uid: String(p.uid),
  };
  const b64 = jsonToB64Url(payload);
  const hex = await hmacSha256Hex(secret, b64);
  return `${b64}.${hex}`;
}

export async function verifySpeedQaProofDetailed(secret, proof, tokenPayload) {
  secret = typeof secret === 'string' ? secret.trim() : '';
  if (!proof || !secret) return { ok: false, reason: 'no_speed_proof_or_secret' };
  const parts = proof.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'bad_speed_proof_format' };
  const [b64, sig] = parts;
  const hex = await hmacSha256Hex(secret, b64);
  if (hex !== sig) return { ok: false, reason: 'speed_sig_mismatch' };
  let payload;
  try {
    payload = b64UrlToJson(b64);
  } catch {
    return { ok: false, reason: 'bad_speed_payload' };
  }
  if (payload.v !== 1) return { ok: false, reason: 'bad_speed_version' };
  if (payload.kind !== 'speed_qa') return { ok: false, reason: 'bad_speed_kind' };
  if (payload.exp !== tokenPayload.exp) return { ok: false, reason: 'speed_exp_mismatch' };
  if (String(payload.uid) !== String(tokenPayload.uid)) return { ok: false, reason: 'speed_uid_mismatch' };
  if (String(payload.cid) !== String(tokenPayload.cid)) return { ok: false, reason: 'speed_cid_mismatch' };
  if (!Array.isArray(payload.idx) || payload.idx.length < 1) return { ok: false, reason: 'bad_speed_idx' };
  return { ok: true, idx: payload.idx };
}
