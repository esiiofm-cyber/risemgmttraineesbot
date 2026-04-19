import { PASSAGES } from '../lib/passages-data.js';
import { getWebTypingSecret } from '../lib/env-secret.js';
import { accuracyPercent, normalizeTypingText, wpmFromText } from '../lib/typing-stats.js';
import { verifyRoundProofDetailed } from '../lib/round-proof.js';
import { signTypingReceipt } from '../lib/typing-receipt.js';
import { verifySignedTokenDetailed } from '../lib/verify-token.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors });
}

function normalizeDiscordBotToken(raw) {
  let t = String(raw ?? '').trim();
  if (/^Bot\s+/i.test(t)) t = t.replace(/^Bot\s+/i, '').trim();
  return t;
}

function discordAuthHeader(env) {
  const t = normalizeDiscordBotToken(env.DISCORD_BOT_TOKEN);
  return t ? `Bot ${t}` : '';
}

class DiscordHttpError extends Error {
  constructor(op, status, bodyText) {
    super(`${op} ${status}: ${bodyText}`);
    this.op = op;
    this.status = status;
    this.bodyText = bodyText;
  }
}

function discordErrorPayload(status, bodyText) {
  if (status === 0) {
    return {
      detail: String(bodyText),
      hint: 'DISCORD_BOT_TOKEN is missing or empty in Pages secrets for this environment (Production vs Preview). Redeploy after saving.',
    };
  }
  let message = bodyText;
  let code = null;
  try {
    const j = JSON.parse(bodyText);
    if (typeof j.message === 'string') message = j.message;
    if (j.code != null) code = j.code;
  } catch {
  }
  const detail = `Discord ${status}: ${message}`;
  let hint =
    'Confirm DISCORD_BOT_TOKEN in Cloudflare matches Developer Portal → Bot (same as BOT_TOKEN in config.py). Bot needs Send Messages + Embed Links in the ticket channel.';
  if (status === 401) {
    hint =
      '401 Unauthorized — token invalid or revoked. Copy the token again from discord.com/developers → Applications → Bot (Reset if needed). Secret must be the raw token only, not "Bot ...". Redeploy Pages after saving.';
  } else if (status === 404) {
    hint =
      '404 Unknown Channel — ticket may be deleted or ID wrong. Open a new application ticket and use a fresh typing link.';
  } else if (status === 403 && code === 50013) {
    hint =
      'Missing Permissions (50013) — in Discord, allow this bot **Send Messages** and **Embed Links** on the ticket category or channel.';
  } else if (status === 403 && code === 50001) {
    hint =
      'Missing Access (50001) — bot cannot access this channel. Fix category/channel permission overwrites for the bot role.';
  } else if (status === 429) {
    hint = 'Rate limited — wait a minute and try Submit again.';
  }
  return { detail, hint };
}

async function discordPost(env, channelId, body) {
  const auth = discordAuthHeader(env);
  if (!auth) throw new DiscordHttpError('POST', 0, 'DISCORD_BOT_TOKEN empty');
  const r = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) {
    throw new DiscordHttpError('POST', r.status, t);
  }
  return t ? JSON.parse(t) : {};
}

async function discordDeleteChannel(env, channelId) {
  const auth = discordAuthHeader(env);
  if (!auth) throw new DiscordHttpError('DELETE', 0, 'DISCORD_BOT_TOKEN empty');
  const r = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
    method: 'DELETE',
    headers: { Authorization: auth },
  });
  if (!r.ok && r.status !== 404) {
    const t = await r.text();
    throw new DiscordHttpError('DELETE', r.status, t);
  }
}

function numEnv(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function handlePost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'bad_json' }, { status: 400, headers: cors });
  }
  const token = typeof body.token === 'string' ? body.token : '';
  const secret = getWebTypingSecret(env);
  if (!secret) {
    return Response.json({ error: 'missing_secret', hint: 'Set WEB_TYPING_SHARED_SECRET for this environment and redeploy.' }, { status: 503, headers: cors });
  }
  const vr = await verifySignedTokenDetailed(token, secret);
  if (!vr.ok) {
    return Response.json({ error: 'invalid_or_expired', reason: vr.reason }, { status: 401, headers: cors });
  }
  const p = vr.payload;
  const roundProof = typeof body.roundProof === 'string' ? body.roundProof : '';
  const rr = await verifyRoundProofDetailed(secret, roundProof, p);
  if (!rr.ok) {
    return Response.json({ error: 'bad_round', reason: rr.reason, hint: 'Reload the page and try again.' }, { status: 400, headers: cors });
  }
  const idxServed = rr.idx;
  const pool = PASSAGES;
  if (!idxServed.every((i) => Number.isInteger(i) && i >= 0 && i < pool.length)) {
    return Response.json({ error: 'bad_round_idx' }, { status: 400, headers: cors });
  }
  const lines = body.lines;
  if (!Array.isArray(lines) || lines.length < 1) {
    return Response.json({ error: 'lines_mismatch' }, { status: 400, headers: cors });
  }
  const minWpm = numEnv(env.TYPE_MIN_WPM_ELIMINATION, 65);
  const colorErr = 0xb91c1c;

  let perW;
  let perA;
  let avgWpm;
  let avgAcc;
  let totalElapsed;
  let exact;

  if (lines.length === 1 && idxServed.length >= 1) {
    const expectedFull = idxServed.map((i) => normalizeTypingText(pool[i])).join(' ');
    const actual = normalizeTypingText(String(lines[0]?.actual ?? ''));
    const elapsed = Number(lines[0]?.elapsed_sec);
    if (!Number.isFinite(elapsed) || elapsed <= 0) {
      return Response.json({ error: 'bad_timing' }, { status: 400, headers: cors });
    }
    if (!actual) {
      return Response.json({ error: 'empty_line' }, { status: 400, headers: cors });
    }
    perW = [wpmFromText(actual, elapsed)];
    perA = [accuracyPercent(expectedFull, actual)];
    avgWpm = perW[0];
    avgAcc = perA[0];
    totalElapsed = elapsed;
    exact = perA[0] >= 99.5;
  } else if (lines.length === idxServed.length) {
    const expectedList = idxServed.map((i) => normalizeTypingText(pool[i]));
    perW = [];
    perA = [];
    for (let i = 0; i < expectedList.length; i++) {
      const actual = normalizeTypingText(String(lines[i]?.actual ?? ''));
      const elapsed = Number(lines[i]?.elapsed_sec);
      if (!Number.isFinite(elapsed) || elapsed <= 0) {
        return Response.json({ error: 'bad_timing' }, { status: 400, headers: cors });
      }
      if (!actual) {
        return Response.json({ error: 'empty_line', line: i + 1 }, { status: 400, headers: cors });
      }
      perW.push(wpmFromText(actual, elapsed));
      perA.push(accuracyPercent(expectedList[i], actual));
    }
    avgWpm = perW.reduce((a, b) => a + b, 0) / perW.length;
    avgAcc = perA.reduce((a, b) => a + b, 0) / perA.length;
    totalElapsed = lines.reduce((s, x) => s + Number(x.elapsed_sec), 0);
    exact = perA.every((x) => x >= 99.5);
  } else {
    return Response.json({ error: 'lines_mismatch' }, { status: 400, headers: cors });
  }
  const uid = String(p.uid);
  const cid = String(p.cid);

  const wpmR = Math.round(avgWpm * 100) / 100;
  const accR = Math.round(avgAcc * 100) / 100;
  const elR = Math.round(totalElapsed * 100) / 100;

  const perWRounded = perW.map((x) => Math.round(x * 100) / 100);
  const perARounded = perA.map((x) => Math.round(x * 100) / 100);

  if (avgWpm < minWpm) {
    const hasApplicationChannel = cid !== '0';
    if (hasApplicationChannel) {
      if (!discordAuthHeader(env)) {
        return Response.json(
          {
            error: 'server_misconfigured',
            hint: 'Add secret DISCORD_BOT_TOKEN in Pages (raw bot token from Developer Portal, no "Bot " prefix). Redeploy.',
          },
          { status: 500, headers: cors },
        );
      }
      try {
        await discordPost(env, cid, {
          embeds: [
            {
              title: 'Application not accepted',
              description:
                perW.length === 1
                  ? `Your **typing speed** for this passage was **${avgWpm.toFixed(1)}** WPM.\nMinimum required: **${minWpm.toFixed(0)}** WPM.\n\nThis application channel will be **deleted**.`
                  : `Your **typing average** for this round was **${avgWpm.toFixed(1)}** WPM.\nMinimum required: **${minWpm.toFixed(0)}** WPM average.\n\nThis application channel will be **deleted**.`,
              color: colorErr,
            },
          ],
        });
      } catch (e) {
        if (e instanceof DiscordHttpError) {
          const p = discordErrorPayload(e.status, e.bodyText);
          return Response.json({ error: 'discord_post_failed', ...p }, { status: 502, headers: cors });
        }
        return Response.json({ error: 'discord_post_failed', detail: String(e) }, { status: 502, headers: cors });
      }
      await new Promise((r) => setTimeout(r, 2000));
      try {
        await discordDeleteChannel(env, cid);
      } catch (e) {
        if (e instanceof DiscordHttpError) {
          const p = discordErrorPayload(e.status, e.bodyText);
          return Response.json({ error: 'discord_delete_failed', ...p }, { status: 502, headers: cors });
        }
        return Response.json({ error: 'discord_delete_failed', detail: String(e) }, { status: 502, headers: cors });
      }
    }
    return Response.json({ ok: true, eliminated: true }, { headers: cors });
  }

  let typingReceipt;
  try {
    typingReceipt = await signTypingReceipt(secret, {
      exp: p.exp,
      uid,
      cid,
      gid: String(p.gid),
      roundProof,
      wpmR,
      accR,
      elR,
      perW: perWRounded,
      perA: perARounded,
      exact: exact ? 1 : 0,
    });
  } catch (e) {
    return Response.json({ error: 'receipt_failed', detail: String(e) }, { status: 500, headers: cors });
  }
  return Response.json({ ok: true, eliminated: false, typingReceipt }, { headers: cors });
}

export async function onRequest(context) {
  const m = context.request.method;
  if (m === 'OPTIONS') return onRequestOptions();
  if (m === 'POST') return handlePost(context);
  return new Response('Method Not Allowed', { status: 405, headers: cors });
}
