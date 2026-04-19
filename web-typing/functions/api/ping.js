import { getWebTypingSecret } from '../lib/env-secret.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405, headers: cors });
  }
  const s = getWebTypingSecret(env);
  const dt = env.DISCORD_BOT_TOKEN;
  return Response.json(
    {
      ok: true,
      wranglerProjectNameHint: 'Must match wrangler.toml name and dashboard Pages project name',
      webTypingSecretConfigured: s.length > 0,
      webTypingSecretLength: s.length,
      discordBotTokenConfigured: typeof dt === 'string' && dt.length > 0,
      envKeyCount: env && typeof env === 'object' ? Object.keys(env).length : 0,
    },
    { headers: { ...cors, 'Content-Type': 'application/json' } },
  );
}
