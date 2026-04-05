/**
 * A.L.E.C. Vercel API Proxy
 * 
 * Transparently proxies all /api/* requests to the A.L.E.C. server
 * running on the owner's Mac via Tailscale Funnel.
 * 
 * The frontend is served statically from frontend/.
 * Anyone can go to a-l-e-c.vercel.app and use A.L.E.C.
 */

const ALEC_URL = process.env.ALEC_LOCAL_URL || 'https://macbook-pro.tail97cec9.ts.net';

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Device-Id');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Strip /api prefix and proxy to A.L.E.C. server
  const path = req.url.replace(/^\/api/, '') || '/';
  const targetUrl = `${ALEC_URL}/api${path}`;

  try {
    const fetchOptions = {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    // Forward auth header
    if (req.headers.authorization) {
      fetchOptions.headers['Authorization'] = req.headers.authorization;
    }
    // Forward device ID
    if (req.headers['x-device-id']) {
      fetchOptions.headers['X-Device-Id'] = req.headers['x-device-id'];
    }

    // Forward body for non-GET requests
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchOptions);
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const data = await response.json();
      return res.status(response.status).json(data);
    } else {
      const text = await response.text();
      res.setHeader('Content-Type', contentType);
      return res.status(response.status).send(text);
    }
  } catch (error) {
    return res.status(502).json({
      error: 'A.L.E.C. server not reachable',
      detail: 'Make sure A.L.E.C. is running on the host machine and Tailscale Funnel is active.',
      hint: 'On the Mac: bash scripts/start-alec.sh && tailscale funnel 3001',
      target: ALEC_URL,
    });
  }
};
