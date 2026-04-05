/**
 * A.L.E.C. Vercel Serverless API Proxy
 *
 * When deployed to Vercel, this proxies API requests to the local
 * A.L.E.C. instance running on the owner's machine via Tailscale.
 *
 * For Domo embeds, this serves as the public API gateway.
 * For direct access, this redirects to the local instance.
 */

const ALEC_LOCAL_URL = process.env.ALEC_LOCAL_URL || 'http://100.81.193.45:3001';

module.exports = async (req, res) => {
  // CORS for Domo embeds
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Health check
  if (req.url === '/api/health' || req.url === '/api/') {
    return res.json({
      status: 'ok',
      service: 'A.L.E.C. Vercel Gateway',
      mode: 'proxy',
      local_url: ALEC_LOCAL_URL,
      timestamp: new Date().toISOString(),
    });
  }

  // Proxy to local A.L.E.C. instance
  try {
    const targetUrl = `${ALEC_LOCAL_URL}${req.url}`;
    const fetchOptions = {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        ...(req.headers.authorization ? { 'Authorization': req.headers.authorization } : {}),
      },
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchOptions);
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(502).json({
      error: 'A.L.E.C. local instance not reachable',
      detail: 'The AI engine runs on the owner\'s hardware. Make sure the local server is running.',
      hint: 'Run: bash scripts/start-alec.sh',
    });
  }
};
