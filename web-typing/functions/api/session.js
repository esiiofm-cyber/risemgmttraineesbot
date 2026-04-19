import { PASSAGES } from '../lib/passages-data.js';
import { SPEED_QUESTIONS } from '../lib/speed-questions-data.js';
import { APPLICATION_QUESTIONS } from '../lib/application-questions-data.js';
import { getWebTypingSecret } from '../lib/env-secret.js';
import { normalizeTypingText } from '../lib/typing-stats.js';
import { signRoundProof } from '../lib/round-proof.js';
import { signSpeedQaProof } from '../lib/speed-qa-proof.js';
import { verifySignedTokenDetailed } from '../lib/verify-token.js';

function pickRandomIndices(poolLen, n) {
  if (n <= 0) return [];
  if (poolLen <= 0) return [];
  const cap = Math.min(n, poolLen);
  const arr = Array.from({ length: poolLen }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const j = buf[0] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  if (n > poolLen) {
    const out = arr.slice(0, cap);
    while (out.length < n) {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      out.push(buf[0] % poolLen);
    }
    return out;
  }
  return arr.slice(0, cap);
}

function shufflePermutation(n) {
  if (n <= 0) return [];
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const j = buf[0] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors });
}

function numEnv(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function handleGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const t = url.searchParams.get('t');
  const secret = getWebTypingSecret(env);
  if (!secret) {
    return Response.json(
      {
        error: 'missing_secret',
        hint: 'Set WEB_TYPING_SHARED_SECRET in Pages → Variables and Secrets. Ensure wrangler.toml name matches your dashboard project name, then redeploy.',
      },
      { status: 503, headers: cors },
    );
  }
  const vr = await verifySignedTokenDetailed(t, secret);
  if (!vr.ok) {
    const hint =
      vr.reason === 'sig_mismatch'
        ? 'Secret on Cloudflare does not match the bot. For URLs like <code>abc123.project.pages.dev</code>, set secrets under <strong>Preview</strong> (not only Production).'
        : '';
    if (vr.reason === 'snowflake_precision' || vr.reason === 'bad_snowflake') {
      return Response.json(
        {
          error: 'invalid_or_expired',
          reason: vr.reason,
          hint: 'This link was issued with an old format. Request a **new** typing link from Discord.',
        },
        { status: 401, headers: cors },
      );
    }
    return Response.json({ error: 'invalid_or_expired', reason: vr.reason, hint }, { status: 401, headers: cors });
  }
  const p = vr.payload;
  const pool = PASSAGES;
  const n = Array.isArray(p.idx) ? p.idx.length : 0;
  if (n < 1) {
    return Response.json({ error: 'bad_session' }, { status: 400, headers: cors });
  }
  const idxNew = pickRandomIndices(pool.length, n);
  const passages = idxNew.map((i) => normalizeTypingText(pool[i]));
  const roundProof = await signRoundProof(secret, {
    idx: idxNew,
    exp: p.exp,
    uid: p.uid,
    cid: p.cid,
  });
  const sqPool = SPEED_QUESTIONS;
  const speedOrder = shufflePermutation(sqPool.length);
  const speedQuestions = speedOrder.map((i) => sqPool[i]);
  const speedQaProof = await signSpeedQaProof(secret, {
    idx: speedOrder,
    exp: p.exp,
    uid: p.uid,
    cid: p.cid,
  });
  const brand = ((env.BRAND_NAME || 'RISE').trim() || 'RISE');
  const minWpm = numEnv(env.TYPE_MIN_WPM_ELIMINATION, 65);
  return Response.json(
    {
      passages,
      exp: p.exp,
      lineCount: passages.length,
      brand,
      minWpm,
      roundProof,
      speedQuestions,
      speedQaProof,
      applicationQuestions: APPLICATION_QUESTIONS,
    },
    { headers: cors },
  );
}

export async function onRequest(context) {
  const m = context.request.method;
  if (m === 'OPTIONS') return onRequestOptions();
  if (m === 'GET') return handleGet(context);
  return new Response('Method Not Allowed', { status: 405, headers: cors });
}
