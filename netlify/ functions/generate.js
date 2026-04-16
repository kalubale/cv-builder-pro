// netlify/functions/generate.js
// ─────────────────────────────────────────────────────────────────────────────
// Secure proxy — forwards AI requests to Anthropic with server-side API key.
// Always returns valid JSON — never returns HTML error pages.
// ─────────────────────────────────────────────────────────────────────────────

const ANTHROPIC_URL     = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

exports.handler = async function (event) {

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors(), body: '' };
  }

  // Only POST allowed
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: { message: 'Method not allowed. Use POST.' } });
  }

  // Check API key is configured
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    console.error('[generate] ANTHROPIC_API_KEY is not set.');
    return respond(500, {
      error: {
        message:
          'ANTHROPIC_API_KEY is not configured. ' +
          'In Netlify go to: Site configuration → Environment variables → ' +
          'Add variable → Key: ANTHROPIC_API_KEY → Value: your sk-ant-... key → ' +
          'Save → Trigger redeploy.',
      },
    });
  }

  // Parse request body
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return respond(400, { error: { message: 'Request body is not valid JSON.' } });
  }

  // Build safe payload — never let client inject auth
  const safePayload = {
    model:      payload.model                       || 'claude-sonnet-4-20250514',
    max_tokens: Math.min(Number(payload.max_tokens) || 4500, 8192),
    system:     typeof payload.system  === 'string' ? payload.system  : '',
    messages:   Array.isArray(payload.messages)     ? payload.messages : [],
  };

  // Call Anthropic
  let anthropicRes;
  try {
    anthropicRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey.trim(),
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(safePayload),
    });
  } catch (networkErr) {
    console.error('[generate] Network error:', networkErr.message);
    return respond(502, {
      error: { message: 'Cannot reach Anthropic API: ' + networkErr.message },
    });
  }

  // Read response as text first
  let responseText;
  try {
    responseText = await anthropicRes.text();
  } catch (readErr) {
    return respond(502, {
      error: { message: 'Failed to read Anthropic response: ' + readErr.message },
    });
  }

  // Validate it is JSON before returning
  try {
    JSON.parse(responseText);
  } catch {
    console.error('[generate] Non-JSON from Anthropic (status ' + anthropicRes.status + '):', responseText.slice(0, 300));
    return respond(502, {
      error: {
        message:
          'Anthropic returned an unexpected response. ' +
          'HTTP status: ' + anthropicRes.status + '. ' +
          'Check that your ANTHROPIC_API_KEY is correct and your account has credits.',
      },
    });
  }

  // Return the valid JSON response
  return {
    statusCode: anthropicRes.status,
    headers: { ...cors(), 'Content-Type': 'application/json' },
    body: responseText,
  };
};

function respond(statusCode, bodyObj) {
  return {
    statusCode,
    headers: { ...cors(), 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyObj),
  };
}

function cors() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
