// netlify/functions/create-paypal-order.js
// ─────────────────────────────────────────────────────────────────────────────
// Creates a PayPal order for $5.99 and returns the orderID to the browser.
//
// REQUIRED ENV VARS in Netlify dashboard:
//   PAYPAL_CLIENT_ID     = ARXPT6z2HjMLJU5whPayBjbr2pi85RiGT4dQM4kIV5BD9dZjvmQVaho_YXPoFFt7B1kowgY1ptcrZV54
//   PAYPAL_CLIENT_SECRET = (from developer.paypal.com → your Live app → Secret)
// ─────────────────────────────────────────────────────────────────────────────

const PAYPAL_API = 'https://api-m.paypal.com'; // Live endpoint
// For sandbox testing swap to: 'https://api-m.sandbox.paypal.com'

// ── Get an access token from PayPal ──────────────────────────────────────────
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

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  // Env vars take priority; values below are the fallback
  const clientId     = process.env.PAYPAL_CLIENT_ID     || 'ARXPT6z2HjMLJU5whPayBjbr2pi85RiGT4dQM4kIV5BD9dZjvmQVaho_YXPoFFt7B1kowgY1ptcrZV54';
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET || 'EKr9qCfVSDzznu_4WE-f_68zMVUwP2cV1cJsic7QcOu9SZfDGWNSMJIJ63XUv8Dr5GZpd3DQm4CrVuDw';

  try {
    // 1. Get access token
    const accessToken = await getAccessToken(clientId, clientSecret);

    // 2. Create order — fixed at $5.99 USD (never trust client-sent amount)
    const orderRes = await fetch(PAYPAL_API + '/v2/checkout/orders', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type':  'application/json',
        'PayPal-Request-Id': 'cvbuilder-' + Date.now(), // idempotency key
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: {
            currency_code: 'USD',
            value: '5.99',
          },
          description: 'CV Builder Pro — CV + Cover Letter Bundle',
          payee: {
            email_address: 'luchizmoo@gmail.com',
          },
        }],
        application_context: {
          brand_name:          'CV Builder Pro',
          landing_page:        'NO_PREFERENCE',
          user_action:         'PAY_NOW',
          shipping_preference: 'NO_SHIPPING',
        },
      }),
    });

    const order = await orderRes.json();
    if (!orderRes.ok) {
      console.error('PayPal order creation failed:', JSON.stringify(order));
      throw new Error(order.message || 'Order creation failed');
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ orderID: order.id }),
    };

  } catch (err) {
    console.error('create-paypal-order error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
