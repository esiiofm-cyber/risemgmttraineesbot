import { APPLICATION_QUESTIONS } from '../lib/application-questions-data.js';
import { SPEED_QUESTIONS } from '../lib/speed-questions-data.js';
import { getWebTypingSecret } from '../lib/env-secret.js';
import { verifyRoundProofDetailed } from '../lib/round-proof.js';
import { verifySpeedQaProofDetailed } from '../lib/speed-qa-proof.js';
import { verifyTypingReceiptDetailed } from '../lib/typing-receipt.js';
import { verifySignedTokenDetailed } from '../lib/verify-token.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const VIEW_CHANNEL = 1024n;
const SEND_MESSAGES = 2048n;
const ATTACH_FILES = 32768n;
const READ_HISTORY = 65536n;
const RESULTS_PERMS = String(VIEW_CHANNEL | SEND_MESSAGES | ATTACH_FILES | READ_HISTORY);
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

const EMBED_COLOR_PURPLE = 0x7823ff;

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
  return t;
}

function discordAuthHeader(env) {
  const t = normalizeDiscordBotToken(env.DISCORD_BOT_TOKEN);
  return t ? `Bot ${t}` : '';
}

class DiscordHttpError extends Error {
  constructor(op, status, bodyText) {
    super(`${op} ${status}: ${bodyText}`);
    this.status = status;
    this.bodyText = bodyText;
  }
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
  if (!r.ok) throw new DiscordHttpError('CREATE_CHANNEL', r.status, t);
  return t ? JSON.parse(t) : {};
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
  if (!r.ok) throw new DiscordHttpError('POST', r.status, t);
  return t ? JSON.parse(t) : {};
}

async function discordPostMultipart(env, channelId, payloadJson, file) {
  const auth = discordAuthHeader(env);
  if (!auth) throw new DiscordHttpError('POST', 0, 'DISCORD_BOT_TOKEN empty');
  const form = new FormData();
  form.append('payload_json', JSON.stringify(payloadJson));
  const bytes = await file.arrayBuffer();
  // Real MP3 from the browser encoder; name + MIME help Discord show the inline player (WebM-as-.mp3 does not decode).
  const blob = new Blob([bytes], { type: 'audio/mpeg' });
  form.append('files[0]', blob, 'voice-note.mp3');
  const r = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: auth,
    },
    body: form,
  });
  const t = await r.text();
  if (!r.ok) throw new DiscordHttpError('POST', r.status, t);
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
    hint = 'Bot needs Manage Channels, Send Messages, Attach Files, and category access.';
  } else if (status === 413) {
    hint = 'The uploaded voice note is too large for Discord. Keep it under 8 MB.';
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

function privateResultsOverwrites(guildId, staffRoleId, applicantUserId) {
  return [
    { id: guildId, type: 0, allow: '0', deny: String(VIEW_CHANNEL) },
    { id: staffRoleId, type: 0, allow: RESULTS_PERMS, deny: '0' },
    { id: applicantUserId, type: 1, allow: RESULTS_PERMS, deny: '0' },
  ];
}

function parseJsonArray(raw) {
  try {
    const v = JSON.parse(String(raw ?? ''));
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

const MAX_EMBED_DESC = 3900;
const MAX_EMBEDS_PER_MESSAGE = 10;
const MAX_EMBED_CHARS_PER_MESSAGE = 5500;

function buildApplicationResultsMarkdown({
  wpmR,
  accR,
  perW,
  pairs,
  answers,
  voiceFileName,
}) {
  const attempts = Array.isArray(perW) ? perW.length : 0;
  const lines = [];
  lines.push('# APPLICATION RESULTS');
  lines.push('');
  lines.push('# 1. Speed Test');
  lines.push(`WPM: ${wpmR}  Attempts: ${attempts}  Accuracy: ${accR}%`);
  lines.push('');
  lines.push('# 2. Speed Q&A');
  lines.push('');
  for (const p of pairs) {
    lines.push(`**${truncateField(p.q, 500)}**`);
    lines.push('');
    lines.push(truncateField(p.reply, 900));
    lines.push('');
    lines.push(`${Number(p.elapsed).toFixed(2)} sec`);
    lines.push('');
  }
  lines.push('# The Questionnaire');
  lines.push('');
  for (let i = 0; i < APPLICATION_QUESTIONS.length; i += 1) {
    lines.push(`**${APPLICATION_QUESTIONS[i].label}**`);
    lines.push('');
    lines.push(truncateField(answers[i] ?? '', 1200));
    lines.push('');
  }
  lines.push('# Voice Note');
  lines.push('');
  lines.push(`${voiceFileName || 'voice-note.mp3'} *(attached to this message)*`);
  return lines.join('\n').trim();
}

function chunkEmbedDescriptions(text, maxLen = MAX_EMBED_DESC) {
  const t = String(text).trim();
  if (!t) return [''];
  if (t.length <= maxLen) return [t];
  const chunks = [];
  let rest = t;
  while (rest.length > 0) {
    if (rest.length <= maxLen) {
      chunks.push(rest.trim());
      break;
    }
    let cut = rest.lastIndexOf('\n\n', maxLen);
    if (cut < maxLen * 0.45) cut = maxLen;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return chunks;
}

function embedPayloadChars(e) {
  let n = 0;
  if (e.title) n += e.title.length;
  if (e.description) n += e.description.length;
  if (e.footer?.text) n += e.footer.text.length;
  if (Array.isArray(e.fields)) {
    for (const f of e.fields) {
      n += (f.name?.length || 0) + (f.value?.length || 0);
    }
  }
  return n;
}

function batchEmbedsForDiscord(embeds) {
  const batches = [];
  let cur = [];
  let chars = 0;
  for (const e of embeds) {
    const sz = embedPayloadChars(e);
    const overCount = cur.length >= MAX_EMBEDS_PER_MESSAGE;
    const overChars = cur.length > 0 && chars + sz > MAX_EMBED_CHARS_PER_MESSAGE;
    if (overCount || overChars) {
      batches.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(e);
    chars += sz;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

async function handlePost(context) {
  const { request, env } = context;
  let form;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: 'bad_form_data' }, { status: 400, headers: cors });
  }

  const token = typeof form.get('token') === 'string' ? form.get('token') : '';
  const typingReceipt = typeof form.get('typingReceipt') === 'string' ? form.get('typingReceipt') : '';
  const speedQaProof = typeof form.get('speedQaProof') === 'string' ? form.get('speedQaProof') : '';
  const questionnaire = parseJsonArray(form.get('questionnaire'));
  const items = parseJsonArray(form.get('items'));
  const voiceNote = form.get('voiceNote');

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
    return Response.json({ error: 'bad_typing_receipt', reason: tr.reason, hint: 'Submit the typing test again, then finish the rest of the application.' }, { status: 400, headers: cors });
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
  const order = sr.idx;
  if (!order.every((i) => Number.isInteger(i) && i >= 0 && i < SPEED_QUESTIONS.length)) {
    return Response.json({ error: 'bad_speed_idx' }, { status: 400, headers: cors });
  }

  if (!Array.isArray(questionnaire) || questionnaire.length !== APPLICATION_QUESTIONS.length) {
    return Response.json({ error: 'bad_questionnaire', hint: `Expected ${APPLICATION_QUESTIONS.length} answers.` }, { status: 400, headers: cors });
  }
  const answers = [];
  for (let i = 0; i < APPLICATION_QUESTIONS.length; i += 1) {
    const spec = APPLICATION_QUESTIONS[i];
    const answer = String(questionnaire[i] ?? '').trim();
    if (spec.required && !answer) {
      return Response.json({ error: 'empty_question', line: i + 1 }, { status: 400, headers: cors });
    }
    if (answer.length > spec.maxLength) {
      return Response.json({ error: 'question_too_long', line: i + 1 }, { status: 400, headers: cors });
    }
    answers.push(answer);
  }

  const questions = order.map((i) => SPEED_QUESTIONS[i]);
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

  if (!voiceNote || typeof voiceNote !== 'object' || typeof voiceNote.arrayBuffer !== 'function') {
    return Response.json({ error: 'missing_voice_note' }, { status: 400, headers: cors });
  }
  if (typeof voiceNote.size === 'number' && voiceNote.size > MAX_AUDIO_BYTES) {
    return Response.json({ error: 'voice_note_too_large', hint: 'Keep the voice note under 8 MB.' }, { status: 400, headers: cors });
  }
  const voiceType = String(voiceNote.type || '');
  if (voiceType && !voiceType.startsWith('audio/') && !voiceType.endsWith('/webm') && voiceType !== 'video/webm') {
    return Response.json({ error: 'bad_voice_note_type', hint: 'Upload or record an audio file.' }, { status: 400, headers: cors });
  }

  if (!discordAuthHeader(env)) {
    return Response.json({ error: 'server_misconfigured', hint: 'Add DISCORD_BOT_TOKEN in Pages.' }, { status: 500, headers: cors });
  }

  const uid = String(p.uid);
  const gid = String(p.gid);
  const categoryId = String(env.WEB_TYPING_RESULTS_CATEGORY_ID || '1494741227772448788').trim();
  const privateRoleId = String(env.WEB_TYPING_RESULTS_PRIVATE_ROLE_ID || '1494741347691925635').trim();
  const overwrites = privateResultsOverwrites(gid, privateRoleId, uid);

  const wpmR = receipt.wpmR;
  const accR = receipt.accR;
  const elR = receipt.elR;
  const perW = receipt.perW;
  const perA = receipt.perA;
  const exact = receipt.exact === 1;
  const syncFooter = `RISE_WT_SYNC:v1|${uid}|${wpmR}|${accR}|${elR}|${perW.join(',')}|${perA.join(',')}|${exact ? 1 : 0}`;

  const voiceFileName =
    voiceNote && typeof voiceNote.name === 'string' && voiceNote.name.trim()
      ? voiceNote.name.trim()
      : 'voice-note.mp3';

  const resultsMarkdown = buildApplicationResultsMarkdown({
    wpmR,
    accR,
    perW,
    pairs,
    answers,
    voiceFileName,
  });
  const resultsChunks = chunkEmbedDescriptions(resultsMarkdown);

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

  const pingContent = `<@&${privateRoleId}> <@${uid}>`;

  const embeds = resultsChunks.map((desc, i) => {
    const n = resultsChunks.length;
    const emb = {
      description: desc.slice(0, 4096),
      color: EMBED_COLOR_PURPLE,
    };
    if (n > 1 && i > 0) emb.title = `APPLICATION RESULTS (${i + 1}/${n})`;
    if (i === 0) emb.footer = { text: syncFooter.slice(0, 2048) };
    return emb;
  });

  const batches = batchEmbedsForDiscord(embeds);

  try {
    await discordPostMultipart(
      env,
      newCid,
      {
        content: pingContent,
        embeds: batches[0],
        allowed_mentions: { roles: [privateRoleId], users: [uid] },
      },
      voiceNote,
    );
    for (let i = 1; i < batches.length; i += 1) {
      await discordPost(env, newCid, { embeds: batches[i] });
    }
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
