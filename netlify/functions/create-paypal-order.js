// netlify/functions/capture-paypal-order.js
// ─────────────────────────────────────────────────────────────────────────────
// Captures (finalises) a PayPal order and verifies it COMPLETED server-side.
// The browser only unlocks downloads when this function returns status=COMPLETED.
// This prevents anyone from faking a payment by calling the unlock code directly.
// ─────────────────────────────────────────────────────────────────────────────

const PAYPAL_API = 'https://api-m.paypal.com'; // Live endpoint

async function getAccessToken(clientId, clientSecret) {
  const credentials = Buffer.from(clientId + ':' + clientSecret).toString('base64');
  const res = await fetch(PAYPAL_API + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + credentials,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!res.ok) throw new Error('PayPal auth failed: ' + (data.error_description || data.error));
  return data.access_token;
}

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { orderID } = body;
  if (!orderID) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing orderID' }) };

  // Env vars take priority; values below are the fallback
  const clientId     = process.env.PAYPAL_CLIENT_ID     || 'ARXPT6z2HjMLJU5whPayBjbr2pi85RiGT4dQM4kIV5BD9dZjvmQVaho_YXPoFFt7B1kowgY1ptcrZV54';
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET || 'EKr9qCfVSDzznu_4WE-f_68zMVUwP2cV1cJsic7QcOu9SZfDGWNSMJIJ63XUv8Dr5GZpd3DQm4CrVuDw';

  try {
    // 1. Get access token
    const accessToken = await getAccessToken(clientId, clientSecret);

    // 2. Capture the order
    const captureRes = await fetch(PAYPAL_API + '/v2/checkout/orders/' + orderID + '/capture', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type':  'application/json',
      },
    });

    const capture = await captureRes.json();

    if (!captureRes.ok) {
      console.error('PayPal capture failed:', JSON.stringify(capture));
      throw new Error(capture.message || 'Capture failed');
    }

    // 3. Verify the amount — must be exactly $5.99 USD
    const unit   = capture.purchase_units?.[0];
    const amount = unit?.payments?.captures?.[0]?.amount;

    if (!amount || amount.currency_code !== 'USD' || parseFloat(amount.value) < 5.99) {
      console.error('Amount mismatch:', amount);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Payment amount invalid', status: capture.status }),
      };
    }

    // 4. Verify status is COMPLETED
    if (capture.status !== 'COMPLETED') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Payment not completed', status: capture.status }),
      };
    }

    // ✅ All good — return COMPLETED to the browser
    console.log('Payment verified:', orderID, amount.value, amount.currency_code);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 'COMPLETED',
        orderID,
        amount: amount.value,
      }),
    };

  } catch (err) {
    console.error('capture-paypal-order error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
