import { SPEED_QUESTIONS } from '../../lib/speed-questions-data.js';
import { getWebTypingSecret } from '../../lib/env-secret.js';
import { verifySpeedQaProofDetailed } from '../../lib/speed-qa-proof.js';
import { verifyRoundProofDetailed } from '../../lib/round-proof.js';
import { verifyTypingReceiptDetailed } from '../../lib/typing-receipt.js';
import { verifySignedTokenDetailed } from '../../lib/verify-token.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors });
}

function normalizeReply(s) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);
}

function normalizeDiscordBotToken(raw) {
  let t = String(raw ?? '').trim();
  if (/^Bot\s+/i.test(t)) t = t.replace(/^Bot\s+/i, '').trim();
  return t ? `Bot ${t}` : '';
}

function discordAuthHeader(env) {
  const t = String(env.DISCORD_BOT_TOKEN ?? '')
    .trim()
    .replace(/^Bot\s+/i, '');
  return t ? `Bot ${t}` : '';
}

class DiscordHttpError extends Error {
  constructor(op, status, bodyText) {
    super(`${op} ${status}: ${bodyText}`);
    this.status = status;
    this.bodyText = bodyText;
  }
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

async function discordCreateGuildChannel(env, guildId, jsonBody) {
  const auth = discordAuthHeader(env);
  if (!auth) throw new DiscordHttpError('POST', 0, 'DISCORD_BOT_TOKEN empty');
  const r = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(jsonBody),
  });
  const t = await r.text();
  if (!r.ok) {
    throw new DiscordHttpError('CREATE_CHANNEL', r.status, t);
  }
  return t ? JSON.parse(t) : {};
}

function discordErrorPayload(status, bodyText) {
  if (status === 0) {
    return {
      detail: String(bodyText),
      hint: 'DISCORD_BOT_TOKEN is missing or empty in Pages secrets.',
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
  let hint = 'Confirm DISCORD_BOT_TOKEN in Cloudflare matches the bot token.';
  if (status === 403 && (code === 50013 || code === 50001)) {
    hint =
      'Bot needs **Manage Channels** and permission to post in the results category. Check role/category overwrites.';
  }
  return {
    detail: `Discord ${status}: ${message}`,
    hint,
  };
}

function truncateField(s, maxLen) {
  const t = String(s).trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

function safeResultsChannelName(uid) {
  const u = String(uid).replace(/\D/g, '').slice(-12) || 'applicant';
  const name = `bench-${u}`.toLowerCase().slice(0, 100);
  return name || 'typing-results';
}

const PERM_THREAD = '68608';

function privateResultsOverwrites(guildId, staffRoleId, applicantUserId) {
  return [
    { id: guildId, type: 0, allow: '0', deny: '1024' },
    { id: staffRoleId, type: 0, allow: PERM_THREAD, deny: '0' },
    { id: applicantUserId, type: 1, allow: PERM_THREAD, deny: '0' },
  ];
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
  const typingReceipt = typeof body.typingReceipt === 'string' ? body.typingReceipt : '';
  const speedQaProof = typeof body.speedQaProof === 'string' ? body.speedQaProof : '';
  const secret = getWebTypingSecret(env);
  if (!secret) {
    return Response.json({ error: 'missing_secret' }, { status: 503, headers: cors });
  }
  const vr = await verifySignedTokenDetailed(token, secret);
  if (!vr.ok) {
    return Response.json({ error: 'invalid_or_expired', reason: vr.reason }, { status: 401, headers: cors });
  }
  const p = vr.payload;
  const tr = await verifyTypingReceiptDetailed(secret, typingReceipt, p);
  if (!tr.ok) {
    return Response.json({ error: 'bad_typing_receipt', reason: tr.reason, hint: 'Submit the typing test again, then complete Speed Q&A.' }, { status: 400, headers: cors });
  }
  const receipt = tr.payload;
  const rr = await verifyRoundProofDetailed(secret, receipt.roundProof, p);
  if (!rr.ok) {
    return Response.json({ error: 'bad_round', reason: rr.reason }, { status: 400, headers: cors });
  }
  const sr = await verifySpeedQaProofDetailed(secret, speedQaProof, p);
  if (!sr.ok) {
    return Response.json({ error: 'bad_speed_proof', reason: sr.reason }, { status: 400, headers: cors });
  }
  const pool = SPEED_QUESTIONS;
  const order = sr.idx;
  if (!order.every((i) => Number.isInteger(i) && i >= 0 && i < pool.length)) {
    return Response.json({ error: 'bad_speed_idx' }, { status: 400, headers: cors });
  }
  const questions = order.map((i) => pool[i]);
  const items = body.items;
  if (!Array.isArray(items) || items.length !== questions.length) {
    return Response.json({ error: 'items_mismatch', hint: `Expected ${questions.length} replies.` }, { status: 400, headers: cors });
  }
  const pairs = [];
  for (let i = 0; i < questions.length; i += 1) {
    const reply = normalizeReply(items[i]?.reply);
    const elapsed = Number(items[i]?.elapsed_sec);
    if (!reply) {
      return Response.json({ error: 'empty_reply', line: i + 1 }, { status: 400, headers: cors });
    }
    if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed > 7200) {
      return Response.json({ error: 'bad_timing', line: i + 1 }, { status: 400, headers: cors });
    }
    pairs.push({ q: questions[i], reply, elapsed });
  }

  if (!discordAuthHeader(env)) {
    return Response.json(
      {
        error: 'server_misconfigured',
        hint: 'Add DISCORD_BOT_TOKEN in Pages.',
      },
      { status: 500, headers: cors },
    );
  }

  const brand = (env.BRAND_NAME || 'RISE').trim() || 'RISE';
  const uid = String(p.uid);
  const gid = String(p.gid);
  const categoryId = String(env.WEB_TYPING_RESULTS_CATEGORY_ID || '1494741227772448788').trim();
  const privateRoleId = String(env.WEB_TYPING_RESULTS_PRIVATE_ROLE_ID || '1494741347691925635').trim();

  const wpmR = receipt.wpmR;
  const accR = receipt.accR;
  const elR = receipt.elR;
  const perW = receipt.perW;
  const perA = receipt.perA;
  const exact = receipt.exact === 1;
  const syncFooter = `RISE_WT_SYNC:v1|${uid}|${wpmR}|${accR}|${elR}|${perW.join(',')}|${perA.join(',')}|${exact ? 1 : 0}`;

  const totalSec = pairs.reduce((s, x) => s + x.elapsed, 0);
  const avgSec = totalSec / pairs.length;
  const fieldLines = pairs.map(
    (x, i) =>
      `**${i + 1}.** ${truncateField(x.q, 180)}\n↳ **Reply:** ${truncateField(x.reply, 380)}\n↳ **Time:** **${x.elapsed.toFixed(2)}s**`,
  );

  const typingLines = perW
    .map((w, i) => `**${i + 1}.** ${Number(w).toFixed(1)} WPM · ${Number(perA[i]).toFixed(1)}%`)
    .join('\n');
  const typingFieldBody = `**${wpmR}** WPM (avg) · **${accR}%** match · **${elR}s** total\n${typingLines}`.slice(0, 1024);

  const overwrites = privateResultsOverwrites(gid, privateRoleId, uid);

  let newChannel;
  try {
    newChannel = await discordCreateGuildChannel(env, gid, {
      name: safeResultsChannelName(uid),
      type: 0,
      parent_id: categoryId,
      permission_overwrites: overwrites,
    });
  } catch (e) {
    if (e instanceof DiscordHttpError) {
      const pl = discordErrorPayload(e.status, e.bodyText);
      return Response.json({ error: 'discord_channel_failed', ...pl }, { status: 502, headers: cors });
    }
    return Response.json({ error: 'discord_channel_failed', detail: String(e) }, { status: 502, headers: cors });
  }

  const newCid = newChannel.id;
  if (!newCid) {
    return Response.json({ error: 'discord_no_channel_id' }, { status: 502, headers: cors });
  }

  try {
    await discordPost(env, newCid, {
      content: `Benchmark results for <@${uid}>`,
      embeds: [
        {
          title: `${brand} · Web benchmark · complete`,
          description: `Applicant: <@${uid}>\nTyping + Speed Q&A submitted together.\n**Private** — only the applicant and the configured staff role can access this channel.`,
          color: 0x243b53,
          fields: [
            {
              name: 'Typing',
              value: typingFieldBody,
              inline: false,
            },
            {
              name: 'Speed Q&A',
              value: `**${pairs.length}** prompts · avg **${avgSec.toFixed(2)}s** · **${totalSec.toFixed(1)}s** total`,
              inline: false,
            },
            {
              name: 'Questions & replies',
              value: fieldLines.join('\n\n').slice(0, 4096),
              inline: false,
            },
          ],
          footer: { text: syncFooter.slice(0, 2048) },
        },
      ],
    });
  } catch (e) {
    if (e instanceof DiscordHttpError) {
      const pl = discordErrorPayload(e.status, e.bodyText);
      return Response.json({ error: 'discord_post_failed', ...pl }, { status: 502, headers: cors });
    }
    return Response.json({ error: 'discord_post_failed', detail: String(e) }, { status: 502, headers: cors });
  }

  return Response.json({ ok: true, resultsChannelId: newCid }, { headers: cors });
}

export async function onRequest(context) {
  const m = context.request.method;
  if (m === 'OPTIONS') return onRequestOptions();
  if (m === 'POST') return handlePost(context);
  return new Response('Method Not Allowed', { status: 405, headers: cors });
}
