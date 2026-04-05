/**
 * A.L.E.C. Vercel Serverless Function
 * 
 * Serves the login page with a configurable API endpoint.
 * The browser connects directly to your A.L.E.C. instance
 * (localhost, LAN, or Tailscale) — Vercel just serves the HTML.
 */

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Return a page that lets user specify their A.L.E.C. server URL
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>A.L.E.C. — Connect</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', -apple-system, sans-serif; background: #0f172a; color: #f8fafc; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: rgba(30,41,59,0.9); border: 1px solid #334155; border-radius: 16px; padding: 40px; max-width: 440px; width: 90%; }
    .logo { text-align: center; margin-bottom: 24px; }
    .logo h1 { font-size: 2rem; background: linear-gradient(135deg, #6366f1, #06b6d4); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .logo p { font-size: 0.7rem; letter-spacing: 3px; color: #94a3b8; margin-top: 4px; }
    label { font-size: 0.75rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 6px; margin-top: 16px; }
    input { width: 100%; padding: 12px; background: #1e293b; border: 1px solid #334155; border-radius: 8px; color: white; font-size: 14px; }
    input:focus { outline: none; border-color: #6366f1; }
    button { width: 100%; padding: 12px; background: linear-gradient(135deg, #6366f1, #8b5cf6); border: none; border-radius: 8px; color: white; font-size: 14px; cursor: pointer; margin-top: 20px; font-weight: 600; }
    button:hover { opacity: 0.9; }
    .status { text-align: center; margin-top: 12px; font-size: 13px; }
    .hint { color: #64748b; font-size: 12px; margin-top: 8px; }
    .saved { background: rgba(16,185,129,0.2); border: 1px solid rgba(16,185,129,0.3); border-radius: 8px; padding: 12px; margin-top: 12px; font-size: 13px; color: #10b981; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <h1>A.L.E.C.</h1>
      <p>Adaptive Learning Executive Coordinator</p>
    </div>
    
    <div id="connect-form">
      <label>Your A.L.E.C. Server URL</label>
      <input type="url" id="server-url" placeholder="http://192.168.1.209:3001" value="">
      <p class="hint">Enter your Mac's IP address + port 3001. Find it in the A.L.E.C. startup log under "LAN".</p>
      
      <button onclick="connectToServer()">Connect</button>
      <div id="status" class="status"></div>
    </div>

    <div id="saved-state" class="saved" style="display:none;">
      ✅ Connected to <span id="saved-url"></span>
      <br><a href="#" id="go-link" style="color:#6366f1;">Open A.L.E.C. Dashboard →</a>
      <br><br><a href="#" onclick="resetConnection()" style="color:#94a3b8;font-size:12px;">Change server</a>
    </div>
  </div>

  <script>
    // Check if we have a saved server URL
    const saved = localStorage.getItem('alec_server_url');
    if (saved) showSaved(saved);

    async function connectToServer() {
      const url = document.getElementById('server-url').value.trim().replace(/\\/$/, '');
      const status = document.getElementById('status');
      if (!url) { status.textContent = 'Please enter a URL'; return; }
      
      status.textContent = 'Connecting...';
      status.style.color = '#f59e0b';
      
      try {
        const resp = await fetch(url + '/health', { mode: 'cors' });
        const data = await resp.json();
        if (data.status === 'ok') {
          localStorage.setItem('alec_server_url', url);
          showSaved(url);
        } else {
          status.textContent = '❌ Server responded but A.L.E.C. is not running';
          status.style.color = '#ef4444';
        }
      } catch (e) {
        status.textContent = '❌ Cannot reach server. Is A.L.E.C. running? Is the URL correct?';
        status.style.color = '#ef4444';
      }
    }

    function showSaved(url) {
      document.getElementById('connect-form').style.display = 'none';
      document.getElementById('saved-state').style.display = 'block';
      document.getElementById('saved-url').textContent = url;
      document.getElementById('go-link').href = url;
    }

    function resetConnection() {
      localStorage.removeItem('alec_server_url');
      document.getElementById('connect-form').style.display = 'block';
      document.getElementById('saved-state').style.display = 'none';
    }
  </script>
</body>
</html>`);
};
