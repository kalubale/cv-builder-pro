// netlify/functions/generate.js
// ─────────────────────────────────────────────────────────────────────────────
// Serverless proxy — keeps your Anthropic API key secret on the server side.
// The browser calls  POST /.netlify/functions/generate
// This function forwards to Anthropic and streams the response back.
//
// SETUP:
//   1. In Netlify dashboard → Site configuration → Environment variables
//   2. Add variable:  ANTHROPIC_API_KEY = sk-ant-api03-...
//   3. Deploy — done. The key never touches the browser.
// ─────────────────────────────────────────────────────────────────────────────

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

exports.handler = async function (event) {
  // ── Only allow POST ────────────────────────────────────────────────────────
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders(),
      body: JSON.stringify({ error: { message: 'Method not allowed' } }),
    };
  }

  // ── Handle CORS preflight ─────────────────────────────────────────────────
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  // ── API key guard ──────────────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY environment variable is not set.');
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({
        error: {
          message:
            'Server configuration error: ANTHROPIC_API_KEY is not set. ' +
            'Add it in Netlify → Site configuration → Environment variables.',
        },
      }),
    };
  }

  // ── Parse + validate incoming body ────────────────────────────────────────
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: { message: 'Invalid JSON body.' } }),
    };
  }

  // Whitelist only the fields we need — never let the client inject the key
  const safePayload = {
    model:      payload.model      || 'claude-sonnet-4-20250514',
    max_tokens: Math.min(payload.max_tokens || 4500, 8192),
    system:     payload.system     || '',
    messages:   payload.messages   || [],
  };

  // ── Forward to Anthropic ───────────────────────────────────────────────────
  let anthropicRes;
  try {
    anthropicRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'x-api-key':            apiKey,
        'anthropic-version':    ANTHROPIC_VERSION,
      },
      body: JSON.stringify(safePayload),
    });
  } catch (networkErr) {
    console.error('Network error reaching Anthropic:', networkErr);
    return {
      statusCode: 502,
      headers: corsHeaders(),
      body: JSON.stringify({
        error: { message: 'Could not reach Anthropic API: ' + networkErr.message },
      }),
    };
  }

  // ── Return Anthropic response as-is ───────────────────────────────────────
  const responseBody = await anthropicRes.text();

  return {
    statusCode: anthropicRes.status,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/json',
    },
    body: responseBody,
  };
};

// ── CORS headers ─────────────────────────────────────────────────────────────
// Restrict to your own domain in production by replacing '*' with your URL,
// e.g. 'https://cvbuilderpro.netlify.app'
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
