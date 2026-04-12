/**
 * ALEC Voice Integration
 * - Neuron canvas in chat panel header (always visible)
 * - Full-screen neuron overlay when voice is active
 * - Mic button in chat input row
 * - Source badges on assistant messages
 * - Hooks into app.js setState / addTypingIndicator / speakResponse
 */
(function () {
'use strict';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  setTimeout(boot, 0);
}

/* ══════════════════════════════════════════════════════
   VOICE STATE
══════════════════════════════════════════════════════ */
let currentState = 'idle';

const STATE_META = {
  idle:         { label:'IDLE',         desc:'Ready — speak or type',        color:'#6366f1', speed:.010, intensity:.22, jitter:.03 },
  listening:    { label:'LISTENING',    desc:'Listening…',                   color:'#06b6d4', speed:.040, intensity:.65, jitter:.14 },
  transcribing: { label:'TRANSCRIBING', desc:'Heard you…',                   color:'#3b82f6', speed:.030, intensity:.55, jitter:.09 },
  thinking:     { label:'THINKING',     desc:'ALEC is reasoning…',           color:'#8b5cf6', speed:.060, intensity:.85, jitter:.24 },
  speaking:     { label:'SPEAKING',     desc:'ALEC is responding…',          color:'#10b981', speed:.045, intensity:.72, jitter:.10 },
  interrupted:  { label:'INTERRUPTED',  desc:'Interrupted…',                 color:'#f59e0b', speed:.025, intensity:.42, jitter:.05 },
  error:        { label:'ERROR',        desc:'Something went wrong.',        color:'#ef4444', speed:.012, intensity:.28, jitter:.04 },
};

let lerpTargetSmall = [99, 102, 241];
let lerpTargetBig   = [99, 102, 241];

// Called by app.js _startCommandCapture to drive neuron
window.setState = function(s) {
  if (!STATE_META[s]) s = 'idle';
  currentState = s;
  const m = STATE_META[s];
  lerpTargetSmall = lerpTargetBig = hexToRgb(m.color);

  // Update strip label
  const label = document.getElementById('alec-state-label');
  const desc  = document.getElementById('alec-state-desc');
  if (label) { label.textContent = m.label; label.style.color = m.color; }
  if (desc)  desc.textContent = m.desc;

  // Update overlay label
  const olabel = document.getElementById('alec-ov-label');
  const odesc  = document.getElementById('alec-ov-desc');
  if (olabel) { olabel.textContent = m.label; olabel.style.color = m.color; }
  if (odesc)  odesc.textContent = m.desc;

  // Show/hide overlay: active for listening/transcribing/thinking/speaking
  const overlay = document.getElementById('alec-overlay');
  if (overlay) {
    const active = s === 'listening' || s === 'transcribing' || s === 'thinking' || s === 'speaking';
    overlay.classList.toggle('active', active);
  }

  updateMicBtn();
};

/* ══════════════════════════════════════════════════════
   STYLES
══════════════════════════════════════════════════════ */
function injectStyles() {
  if (document.getElementById('alec-voice-styles')) return;
  const s = document.createElement('style');
  s.id = 'alec-voice-styles';
  s.textContent = `
    /* ── Strip (small canvas in chat header) ── */
    #alec-voice-strip {
      display:flex; align-items:center; gap:10px; padding:8px 16px; flex-shrink:0;
      background:linear-gradient(90deg,rgba(10,13,20,.98),rgba(17,24,39,.98));
      border-bottom:1px solid rgba(30,42,66,.7);
    }
    #alec-neuron-small { border-radius:50%; display:block; flex-shrink:0; cursor:pointer; }
    #alec-state-label { font-size:10px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:#06b6d4; transition:color .4s; }
    #alec-state-desc  { font-size:11px; color:#6b7280; margin-top:1px; }
    #alec-vol-track   { width:56px; height:3px; background:rgba(255,255,255,.06); border-radius:2px; overflow:hidden; flex-shrink:0; }
    #alec-vol-fill    { height:100%; width:0%; background:linear-gradient(90deg,#06b6d4,#6366f1); transition:width .05s linear; }

    /* ── Full-screen overlay (Jarvis HUD) ── */
    #alec-overlay {
      position:fixed; inset:0; z-index:9999;
      background:rgba(2,4,12,.96);
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      opacity:0; pointer-events:none;
      transition:opacity .4s ease;
      overflow:hidden;
    }
    #alec-overlay.active { opacity:1; pointer-events:all; }

    /* Full-screen canvas behind everything */
    #alec-ov-canvas {
      position:absolute; inset:0; width:100%; height:100%;
      display:block;
    }

    /* HUD overlay content floats above canvas */
    #alec-ov-content {
      position:relative; z-index:2;
      display:flex; flex-direction:column; align-items:center; gap:20px;
      pointer-events:none;
    }

    #alec-ov-glow {
      position:absolute; inset:0;
      pointer-events:none; transition:background .5s;
    }
    #alec-ov-label {
      font-size:11px; font-weight:800; letter-spacing:.3em; text-transform:uppercase;
      color:#06b6d4; transition:color .4s;
      text-shadow:0 0 20px currentColor;
      font-family:"SF Mono","Fira Code",monospace;
    }
    #alec-ov-desc {
      font-size:13px; color:#4b6080; margin-top:-14px;
      font-family:"SF Mono","Fira Code",monospace;
      letter-spacing:.08em;
    }
    #alec-ov-transcript {
      font-size:20px; color:#e2e8f0; max-width:600px; text-align:center;
      min-height:32px; font-style:italic; opacity:.85;
      text-shadow:0 0 30px rgba(6,182,212,.4);
    }
    #alec-ov-dismiss {
      padding:8px 24px; border-radius:999px; border:1px solid rgba(6,182,212,.2);
      background:rgba(6,182,212,.05); color:#4b6080; font-size:12px;
      cursor:pointer; transition:all .2s; margin-top:4px;
      pointer-events:all; font-family:"SF Mono",monospace; letter-spacing:.05em;
    }
    #alec-ov-dismiss:hover { border-color:#ef4444; color:#ef4444; }

    /* ── Interim bar ── */
    #alec-interim {
      font-size:11px; color:#4b5563; font-style:italic; padding:0 16px;
      max-height:0; overflow:hidden; transition:max-height .2s,padding .2s;
      background:rgba(10,13,20,.9);
    }
    #alec-interim.active { max-height:22px; padding:4px 16px; }

    /* ── Mic button ── */
    #alec-mic-btn {
      width:36px; height:36px; border-radius:50%;
      border:1px solid rgba(30,58,95,.8); background:rgba(30,41,59,.9);
      color:#6b7280; font-size:15px; cursor:pointer; flex-shrink:0;
      display:flex; align-items:center; justify-content:center; transition:all .2s;
    }
    #alec-mic-btn:hover { border-color:#06b6d4; color:#06b6d4; }
    #alec-mic-btn.listening {
      background:linear-gradient(135deg,#7f1d1d,#dc2626); border-color:#dc2626; color:#fff;
      animation:alec-pulse .9s ease-in-out infinite;
    }
    #alec-mic-btn.speaking { background:linear-gradient(135deg,#064e3b,#059669); border-color:#10b981; color:#fff; }
    #alec-mic-btn.thinking { border-color:#8b5cf6; color:#8b5cf6; }
    @keyframes alec-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.1)} }

    /* ── Streaming cursor ── */
    .stream-cursor {
      display:inline-block; width:.6em; background:#06b6d4; border-radius:1px;
      animation:alec-blink .7s step-end infinite; margin-left:1px; vertical-align:text-bottom;
    }
    @keyframes alec-blink { 0%,100%{opacity:1} 50%{opacity:0} }
    .chat-message.streaming .msg-bubble { opacity:.9; }

    /* ── Feedback buttons ── */
    .feedback-btn { background:none; border:none; cursor:pointer; font-size:14px; opacity:.4; transition:opacity .2s,transform .1s; padding:0 2px; }
    .feedback-btn:hover { opacity:1; transform:scale(1.2); }
    .feedback-btn.active-up   { opacity:1; filter:drop-shadow(0 0 4px #10b981); }
    .feedback-btn.active-down { opacity:1; filter:drop-shadow(0 0 4px #ef4444); }

    /* ── Source badges ── */
    .alec-src-badge { display:inline-flex;align-items:center;gap:3px;padding:1px 7px;border-radius:10px;font-size:10px;font-weight:500;margin-right:6px; }
    .alec-src-llm          { background:rgba(59,130,246,.12); border:1px solid rgba(59,130,246,.25); color:#60a5fa; }
    .alec-src-stoa         { background:rgba(139,92,246,.12); border:1px solid rgba(139,92,246,.25); color:#a78bfa; }
    .alec-src-memory       { background:rgba(16,185,129,.12); border:1px solid rgba(16,185,129,.25); color:#34d399; }
    .alec-src-correction   { background:rgba(245,158,11,.12); border:1px solid rgba(245,158,11,.25); color:#fbbf24; }
    .alec-src-deterministic{ background:rgba(6,182,212,.12);  border:1px solid rgba(6,182,212,.25);  color:#22d3ee; }
    .alec-src-refusal      { background:rgba(239,68,68,.12);  border:1px solid rgba(239,68,68,.25);  color:#f87171; }
  `;
  document.head.appendChild(s);
}

/* ══════════════════════════════════════════════════════
   FULL-SCREEN OVERLAY
══════════════════════════════════════════════════════ */
function injectOverlay() {
  if (document.getElementById('alec-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'alec-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'ALEC voice interface');

  const glow = document.createElement('div');
  glow.id = 'alec-ov-glow';

  // Full-screen canvas — sized to window, not fixed 280x280
  const canvas = document.createElement('canvas');
  canvas.id = 'alec-ov-canvas';

  // Content floats above the canvas
  const content = document.createElement('div');
  content.id = 'alec-ov-content';

  const label = document.createElement('div');
  label.id = 'alec-ov-label';
  label.textContent = 'LISTENING';

  const desc = document.createElement('div');
  desc.id = 'alec-ov-desc';
  desc.textContent = 'Listening…';

  const transcript = document.createElement('div');
  transcript.id = 'alec-ov-transcript';

  const dismiss = document.createElement('button');
  dismiss.id = 'alec-ov-dismiss';
  dismiss.type = 'button';
  dismiss.textContent = '✕  Dismiss';
  dismiss.addEventListener('click', () => {
    _endConversation();
    overlay.classList.remove('active');
    window.setState('idle');
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (window._ttsAudio) { try { window._ttsAudio.pause(); } catch(_){} }
    if (recognition) { try { recognition.abort(); } catch(_){} recognition = null; }
    stopAmpMeter();
    isRecording = false;
    updateMicBtn();
    if (_wakeWasActive && typeof startVoiceListening === 'function') {
      _wakeWasActive = false;
      setTimeout(startVoiceListening, 600);
    }
  });

  content.appendChild(label);
  content.appendChild(desc);
  content.appendChild(transcript);
  content.appendChild(dismiss);

  overlay.appendChild(glow);
  overlay.appendChild(canvas);
  overlay.appendChild(content);
  document.body.appendChild(overlay);
}

/* ══════════════════════════════════════════════════════
   VOICE STRIP (small canvas)
══════════════════════════════════════════════════════ */
function injectVoiceStrip() {
  const chatPanel = document.getElementById('panel-chat');
  if (!chatPanel || document.getElementById('alec-voice-strip')) return;

  const strip = document.createElement('div');
  strip.id = 'alec-voice-strip';

  const smallCanvas = document.createElement('canvas');
  smallCanvas.id = 'alec-neuron-small';
  smallCanvas.width = 48; smallCanvas.height = 48;
  smallCanvas.title = 'Click to activate voice';
  smallCanvas.addEventListener('click', toggleMic);

  const info = document.createElement('div');
  info.style.cssText = 'flex:1;min-width:0;';

  const label = document.createElement('div');
  label.id = 'alec-state-label';
  label.textContent = 'IDLE';

  const desc = document.createElement('div');
  desc.id = 'alec-state-desc';
  desc.textContent = 'Ready — speak or type';

  info.appendChild(label);
  info.appendChild(desc);

  const volTrack = document.createElement('div');
  volTrack.id = 'alec-vol-track';
  const volFill = document.createElement('div');
  volFill.id = 'alec-vol-fill';
  volTrack.appendChild(volFill);

  strip.appendChild(smallCanvas);
  strip.appendChild(info);
  strip.appendChild(volTrack);

  const msgs = chatPanel.querySelector('.chat-messages');
  chatPanel.insertBefore(strip, msgs || chatPanel.firstChild);

  // Interim bar
  const interim = document.createElement('div');
  interim.id = 'alec-interim';
  const inputArea = chatPanel.querySelector('.chat-input-area');
  if (inputArea) chatPanel.insertBefore(interim, inputArea);
}

/* ══════════════════════════════════════════════════════
   MIC BUTTON
══════════════════════════════════════════════════════ */
function injectMicButton() {
  const wrapper = document.querySelector('.chat-input-wrapper');
  if (!wrapper || document.getElementById('alec-mic-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'alec-mic-btn'; btn.type = 'button';
  btn.title = 'Voice input'; btn.setAttribute('aria-label', 'Voice input');
  btn.textContent = '🎤';
  btn.addEventListener('click', toggleMic);
  wrapper.insertBefore(btn, wrapper.firstChild);
}

/* ══════════════════════════════════════════════════════
   MIC / RECOGNITION
══════════════════════════════════════════════════════ */
let isRecording = false;
let recognition = null;
let micAmp = 0;
let ttsAmp = 0;
let ampInterval = null;

let _wakeWasActive = false; // track if wake word loop was running when we took over

// ── Continuous conversation session ──────────────────────────
let conversationActive = false;   // true = auto-resume mic after each response
let conversationTimer  = null;    // 2-min silence timeout handle
const CONVERSATION_TIMEOUT = 2 * 60 * 1000; // 2 minutes

function _resetConversationTimer() {
  clearTimeout(conversationTimer);
  if (conversationActive) {
    conversationTimer = setTimeout(() => {
      conversationActive = false;
      _showToast('Conversation ended — no activity for 2 minutes.');
      if (isRecording) stopMic(); else window.setState('idle');
    }, CONVERSATION_TIMEOUT);
  }
}

function _endConversation() {
  conversationActive = false;
  clearTimeout(conversationTimer);
}

function _showToast(msg) {
  if (typeof toast === 'function') toast(msg, 'info');
  else console.info('[ALEC]', msg);
}

// Update overlay cancel / dismiss button text to reflect session
function _updateDismissBtn() {
  const btn = document.getElementById('alec-ov-dismiss');
  if (!btn) return;
  btn.textContent = conversationActive ? '✕  End Conversation' : '✕  Cancel';
}

function toggleMic() {
  if (isRecording || conversationActive) {
    stopMic();           // stop + end conversation session
  } else {
    startMic({ conversation: true });   // manual tap begins a conversation session
  }
}

window.stopMic = function stopMic() {
  _endConversation();                                // kill auto-resume session
  if (recognition) { try { recognition.abort(); } catch(_){} recognition = null; }
  stopAmpMeter();
  isRecording = false;
  updateMicBtn();
  window.setState('idle');
  // Re-enable wake word loop if it was active before we took the mic
  if (_wakeWasActive && typeof startVoiceListening === 'function') {
    _wakeWasActive = false;
    setTimeout(startVoiceListening, 400);
  }
};

function startMic(opts) {
  // opts = { conversation: true } to begin/continue auto-resume loop
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    _showToast('Voice recognition requires Chrome or Edge.');
    return;
  }

  if (opts && opts.conversation) {
    conversationActive = true;
    _resetConversationTimer();
    _updateDismissBtn();
  }

  // Pause wake word loop — Chrome only allows one SpeechRecognition at a time
  if (typeof _voiceListening !== 'undefined' && _voiceListening) {
    _wakeWasActive = true;
    if (typeof stopVoiceListening === 'function') stopVoiceListening();
  }

  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (window._ttsAudio) { try { window._ttsAudio.pause(); } catch(_){} }

  // Small delay to ensure Chrome releases the mic from the wake word session
  setTimeout(_doStart, 250);
}

function _doStart() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous    = true;   // keep listening until ⏹ is tapped
  recognition.interimResults = true;
  recognition.lang           = 'en-US';
  recognition.maxAlternatives = 1;

  let sentFinal = false;

  recognition.onstart = async () => {
    isRecording = true;
    sentFinal = false;
    window.setState('listening');
    updateMicBtn();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
      startAmpMeter(stream);
    } catch(_){}
  };

  recognition.onend = () => {
    // continuous=true fires onend only when aborted or on error — restart unless user stopped
    if (isRecording && !sentFinal) {
      // Unexpected end — restart
      try { recognition.start(); } catch(_) { _handleStop(); }
    } else {
      _handleStop();
    }
  };

  recognition.onerror = (e) => {
    const code = (e && e.error) ? e.error : 'error';
    if (code === 'not-allowed') {
      if (typeof toast === 'function') toast('Microphone blocked — allow in browser settings.', 'error');
      _handleStop();
      return;
    }
    // aborted = user stopped, no-speech = silence, network = reconnect
    if (code === 'aborted') { _handleStop(); return; }
    // For no-speech just keep going (recognition restarts via onend)
  };

  recognition.onresult = (ev) => {
    let interim = '', final = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      if (ev.results[i].isFinal) final += ev.results[i][0].transcript + ' ';
      else interim += ev.results[i][0].transcript;
    }

    const bar = document.getElementById('alec-interim');
    const ovt = document.getElementById('alec-ov-transcript');

    if (interim) {
      window.setState('transcribing');
      if (bar) { bar.textContent = interim; bar.classList.add('active'); }
      if (ovt) ovt.textContent = interim;
      const ci = document.getElementById('chat-input');
      if (ci) ci.value = interim;
    }
    if (final.trim()) {
      sentFinal = true;
      // Mark conversation active — mic will auto-resume after ALEC responds
      conversationActive = true;
      _resetConversationTimer();
      _updateDismissBtn();

      if (bar) { bar.textContent=''; bar.classList.remove('active'); }
      if (ovt) ovt.textContent = final.trim();
      const ci = document.getElementById('chat-input');
      if (ci) { ci.value = final.trim(); ci.dispatchEvent(new Event('input')); }
      if (typeof state !== 'undefined') state._voiceTriggered = true;
      if (typeof sendMessage === 'function') sendMessage();
      // Stop recording after a command is sent
      try { recognition.abort(); } catch(_){}
    }
  };

  try { recognition.start(); }
  catch(e) {
    isRecording = false; updateMicBtn();
    if (typeof toast === 'function') toast('Cannot start mic: ' + e.message, 'error');
  }
}

function _handleStop() {
  stopAmpMeter();
  isRecording = false;
  updateMicBtn();
  // Only go idle if no conversation is continuing (speakResponse will drive state)
  if (!conversationActive && (currentState === 'listening' || currentState === 'transcribing')) {
    window.setState('idle');
  }
  if (_wakeWasActive && !conversationActive && typeof startVoiceListening === 'function') {
    _wakeWasActive = false;
    setTimeout(startVoiceListening, 400);
  }
}

function updateMicBtn() {
  const btn = document.getElementById('alec-mic-btn');
  if (!btn) return;
  btn.classList.remove('listening','speaking','thinking');
  if (isRecording) {
    btn.classList.add('listening'); btn.textContent='⏹'; btn.title='Stop recording';
  } else if (currentState === 'speaking') {
    btn.classList.add('speaking'); btn.textContent='🔊'; btn.title='Speaking…';
  } else if (currentState === 'thinking') {
    btn.classList.add('thinking'); btn.textContent='🧠'; btn.title='Thinking…';
  } else {
    btn.textContent='🎤'; btn.title='Voice input';
  }
}

function startAmpMeter(stream) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const an = ctx.createAnalyser(); an.fftSize = 256;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.frequencyBinCount);
    clearInterval(ampInterval);
    ampInterval = setInterval(() => {
      an.getByteFrequencyData(buf);
      micAmp = Math.min(buf.reduce((a,b)=>a+b,0)/buf.length/90, 1);
      const f = document.getElementById('alec-vol-fill');
      if (f) f.style.width = (micAmp*100).toFixed(0)+'%';
    }, 40);
  } catch(_){}
}

function stopAmpMeter() {
  clearInterval(ampInterval); micAmp = 0;
  const f = document.getElementById('alec-vol-fill');
  if (f) f.style.width = '0%';
}

/* ══════════════════════════════════════════════════════
   NEURON CANVAS ANIMATION
══════════════════════════════════════════════════════ */
/* ── Clean text for natural speech ── */
function cleanForSpeech(text) {
  return text
    // Always pronounce the name naturally — never spell out the acronym
    .replace(/A\.L\.E\.C\./gi, 'Alec')
    .replace(/\bALEC\b/g, 'Alec')
    // Strip all emoji (Unicode ranges)
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/[\u{FE00}-\u{FEFF}]/gu, '')
    // Strip markdown: **bold**, *italic*, `code`, # headers, > quotes, --- dividers
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/^-{3,}$/gm, '')
    // Strip URLs
    .replace(/https?:\/\/\S+/g, '')
    // Strip leftover symbols that sound bad read aloud
    .replace(/[•◦▸▹►▻–—]/g, ',')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // markdown links → label only
    // Collapse extra whitespace
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function hexToRgb(h){ const n=parseInt(h.replace('#',''),16); return[(n>>16)&255,(n>>8)&255,n&255]; }
function lerpC(a,b,t){ return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t]; }
function rgb(c,a){ return`rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`; }

// ══════════════════════════════════════════════════════════════
//  SMALL CANVAS (48×48 in header strip) — lightweight neural orb
// ══════════════════════════════════════════════════════════════
const SMALL_FRAC = [
  [.50,.50],[.27,.33],[.73,.33],[.20,.58],[.80,.58],
  [.50,.15],[.50,.85],[.08,.25],[.92,.25],
  [.05,.55],[.95,.55],[.27,.78],[.73,.78],
];
const SMALL_EDGES=[[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[1,3],[1,7],[2,4],[2,8],[3,9],[4,10],[5,7],[5,8],[6,11],[6,12]];

function buildSmallNodes(W,H){ return SMALL_FRAC.map(([fx,fy])=>({x:fx*W,y:fy*H,r:Math.max(W/28,2)})); }

let animT = 0;
const sparksSmall = [];

function drawSmallNeuron(ctx, W, H, nodes, lerpCur, lerpTarget, m) {
  lerpCur = lerpC(lerpCur, lerpTarget, 0.06);
  const c = lerpCur;
  const amp   = Math.max(micAmp, ttsAmp);
  const pulse = m.intensity + amp*.3 + Math.sin(animT*3.1)*.05;

  ctx.clearRect(0,0,W,H);
  const bg=ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,W/2);
  bg.addColorStop(0,rgb(c,pulse*.18)); bg.addColorStop(1,'transparent');
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

  SMALL_EDGES.forEach(([ai,bi])=>{
    const a=nodes[ai],b=nodes[bi];
    ctx.beginPath(); ctx.strokeStyle=rgb(c,.1+pulse*.25);
    ctx.lineWidth=Math.max(.4,W/80); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
  });

  if((currentState==='thinking'||currentState==='speaking')&&Math.random()<.12){
    const ei=(Math.random()*SMALL_EDGES.length)|0;
    sparksSmall.push({ai:SMALL_EDGES[ei][0],bi:SMALL_EDGES[ei][1],t:0,spd:.022+Math.random()*.02});
  }
  for(let i=sparksSmall.length-1;i>=0;i--){
    const sp=sparksSmall[i]; sp.t+=sp.spd;
    if(sp.t>=1){sparksSmall.splice(i,1);continue;}
    const a=nodes[sp.ai],b=nodes[sp.bi];
    const sx=a.x+(b.x-a.x)*sp.t, sy=a.y+(b.y-a.y)*sp.t;
    ctx.beginPath(); ctx.arc(sx,sy,Math.max(1.2,W/22),0,Math.PI*2);
    ctx.fillStyle=rgb(c,.9); ctx.fill();
  }

  nodes.forEach((n,i)=>{
    const np=pulse+Math.sin(animT+i*.7)*.1;
    const nr=n.r*(1+np*.3);
    const gl=ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,nr*3);
    gl.addColorStop(0,rgb(c,np*.5)); gl.addColorStop(1,'transparent');
    ctx.beginPath(); ctx.arc(n.x,n.y,nr*3,0,Math.PI*2); ctx.fillStyle=gl; ctx.fill();
    ctx.beginPath(); ctx.arc(n.x,n.y,nr,0,Math.PI*2); ctx.fillStyle=rgb(c,.8+np*.2); ctx.fill();
  });

  return lerpCur;
}

// ══════════════════════════════════════════════════════════════
//  BIG CANVAS — JARVIS-LEVEL FULL-SCREEN HUD
//  Inspired by Iron Man's JARVIS interface.
//  Layers: hex grid · concentric rings · 80-node neural web ·
//          energy sparks · scan line · data streams · particle field
// ══════════════════════════════════════════════════════════════

// Build a rich neural network across the full canvas
function buildJarvisNodes(W, H) {
  const nodes = [];
  // Centre hero node
  nodes.push({ x: W*.5, y: H*.5, r: 6, role: 'hub' });
  // Orbital ring 1 (8 nodes)
  for (let i=0;i<8;i++){
    const a=i/8*Math.PI*2, r=Math.min(W,H)*.16;
    nodes.push({ x: W*.5+Math.cos(a)*r, y: H*.5+Math.sin(a)*r, r:4, role:'mid' });
  }
  // Orbital ring 2 (14 nodes)
  for (let i=0;i<14;i++){
    const a=i/14*Math.PI*2+.2, r=Math.min(W,H)*.29;
    nodes.push({ x: W*.5+Math.cos(a)*r, y: H*.5+Math.sin(a)*r, r:3, role:'outer' });
  }
  // Scatter (20 nodes across the full canvas)
  for (let i=0;i<20;i++){
    nodes.push({ x: Math.random()*W, y: Math.random()*H, r:2+Math.random()*2, role:'scatter' });
  }
  // Corner anchors
  [[.05,.08],[.95,.08],[.05,.92],[.95,.92],[.5,.04],[.5,.96],[.04,.5],[.96,.5]].forEach(([fx,fy])=>{
    nodes.push({ x:fx*W, y:fy*H, r:2.5, role:'anchor' });
  });
  return nodes;
}

function buildJarvisEdges(nodes) {
  const edges = [];
  // Hub to ring 1
  for(let i=1;i<=8;i++) edges.push([0,i]);
  // Ring 1 to ring 2 (each ring-1 connects to 2 ring-2)
  for(let i=0;i<8;i++){
    const base = 9 + Math.floor(i/8*14);
    edges.push([i+1, base % 14 + 9]);
    edges.push([i+1, (base+1) % 14 + 9]);
  }
  // Ring 1 neighbours
  for(let i=0;i<8;i++) edges.push([i+1, ((i+1)%8)+1]);
  // Ring 2 neighbours
  for(let i=0;i<14;i++) edges.push([9+i, 9+((i+1)%14)]);
  // Scatter to nearest ring-2 nodes (approximate)
  for(let s=23;s<43;s++){
    const n = nodes[s];
    let closest = 9;
    let cd = Infinity;
    for(let r=9;r<23;r++){
      const d=(nodes[r].x-n.x)**2+(nodes[r].y-n.y)**2;
      if(d<cd){cd=d;closest=r;}
    }
    edges.push([s, closest]);
    if(Math.random()>.5) edges.push([s, ((closest-9+1)%14)+9]);
  }
  // Corner anchors to nearest scatter
  for(let a=43;a<51;a++){
    const n=nodes[a];
    let closest=23, cd=Infinity;
    for(let s=23;s<43;s++){
      const d=(nodes[s].x-n.x)**2+(nodes[s].y-n.y)**2;
      if(d<cd){cd=d;closest=s;}
    }
    edges.push([a,closest]);
  }
  return edges;
}

let jarvisNodes = null;
let jarvisEdges = null;
const jarvisSparks = [];

// Hexagonal grid (for the background HUD pattern)
function drawHexGrid(ctx, W, H, c, alpha) {
  const size = 38;
  const h3   = Math.sqrt(3);
  ctx.save();
  ctx.strokeStyle = rgb(c, alpha);
  ctx.lineWidth   = 0.4;
  const cols = Math.ceil(W / (size * 1.5)) + 2;
  const rows = Math.ceil(H / (size * h3))  + 2;
  for(let col=-1; col<cols; col++){
    for(let row=-1; row<rows; row++){
      const cx = col * size * 1.5;
      const cy = row * size * h3 + (col % 2 ? size * h3 / 2 : 0);
      ctx.beginPath();
      for(let k=0;k<6;k++){
        const ang = k * Math.PI/3 + Math.PI/6;
        const px = cx + size*.85 * Math.cos(ang);
        const py = cy + size*.85 * Math.sin(ang);
        k === 0 ? ctx.moveTo(px,py) : ctx.lineTo(px,py);
      }
      ctx.closePath(); ctx.stroke();
    }
  }
  ctx.restore();
}

// Concentric energy rings that pulse with the state
function drawRings(ctx, W, H, c, amp, pulse) {
  const cx = W/2, cy = H/2;
  const maxR = Math.min(W, H) * 0.45;
  [.22,.34,.44].forEach((frac, ri) => {
    const r   = maxR * frac;
    const osc = Math.sin(animT * (1.8 + ri*.6) + ri*1.1) * 0.08 * (1+amp);
    const al  = (0.08 + pulse*.15 + osc) * (1 - ri*.18);
    ctx.beginPath();
    ctx.arc(cx, cy, r * (1 + osc*.4), 0, Math.PI*2);
    ctx.strokeStyle = rgb(c, al);
    ctx.lineWidth   = 1 + pulse * 2 + amp * 3;
    ctx.stroke();

    // Tick marks on the outermost ring
    if(ri === 2) {
      for(let t=0;t<36;t++){
        const a = t/36 * Math.PI*2 + animT*.3;
        const ir = r * .94, or_ = r * (t%3===0 ? 1.06 : 1.02);
        ctx.beginPath();
        ctx.moveTo(cx+Math.cos(a)*ir, cy+Math.sin(a)*ir);
        ctx.lineTo(cx+Math.cos(a)*or_, cy+Math.sin(a)*or_);
        ctx.strokeStyle = rgb(c, t%3===0 ? al*2 : al*.6);
        ctx.lineWidth = t%3===0 ? 1.5 : 0.6;
        ctx.stroke();
      }
    }
  });
}

// Rotating scan line (like radar)
function drawScanLine(ctx, W, H, c, amp) {
  const cx=W/2, cy=H/2;
  const scanA = animT * 1.4;
  const len   = Math.min(W,H) * 0.46;
  const grad  = ctx.createLinearGradient(cx,cy, cx+Math.cos(scanA)*len, cy+Math.sin(scanA)*len);
  grad.addColorStop(0, rgb(c, 0.3 + amp*.3));
  grad.addColorStop(1, 'transparent');
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, len, scanA - .18, scanA, false);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
}

// Data stream lines along edges (fast-moving dashes)
function drawDataStreams(ctx, nodes, edges, c, pulse) {
  const active = Math.random() < .35;
  if(!active) return;
  const ei = (Math.random()*edges.length)|0;
  const [ai,bi] = edges[ei];
  const a=nodes[ai], b=nodes[bi];
  const t = (animT * 2.5) % 1;
  const sx = a.x+(b.x-a.x)*t, sy=a.y+(b.y-a.y)*t;
  ctx.beginPath(); ctx.arc(sx,sy,2.5,0,Math.PI*2);
  ctx.fillStyle=rgb(c,0.9); ctx.fill();
  // Trail
  const t2=Math.max(0,t-.06);
  const tx=a.x+(b.x-a.x)*t2, ty=a.y+(b.y-a.y)*t2;
  ctx.beginPath(); ctx.arc(tx,ty,1.2,0,Math.PI*2);
  ctx.fillStyle=rgb(c,0.35); ctx.fill();
}

// Floating particle field
const hudParticles = Array.from({length:60},()=>({
  x:Math.random(), y:Math.random(), vx:(Math.random()-.5)*.0003, vy:(Math.random()-.5)*.0003,
  r: .6+Math.random()*.8, a:Math.random()
}));

function drawParticles(ctx, W, H, c, amp) {
  hudParticles.forEach(p => {
    p.x+=p.vx*(1+amp*4); p.y+=p.vy*(1+amp*4);
    if(p.x<0) p.x=1; if(p.x>1) p.x=0;
    if(p.y<0) p.y=1; if(p.y>1) p.y=0;
    ctx.beginPath(); ctx.arc(p.x*W,p.y*H,p.r,0,Math.PI*2);
    ctx.fillStyle=rgb(c,0.1+p.a*.15+amp*.15); ctx.fill();
  });
}

function drawJarvisHUD(ctx, W, H, lerpCur, lerpTarget, m) {
  // Resize canvas to match window
  if(ctx.canvas.width !== W) ctx.canvas.width = W;
  if(ctx.canvas.height !== H) ctx.canvas.height = H;

  lerpCur = lerpC(lerpCur, lerpTarget, 0.05);
  const c   = lerpCur;
  const amp = Math.max(micAmp, ttsAmp);
  const pulse = m.intensity + amp*.35 + Math.sin(animT*2.8)*.06;

  ctx.clearRect(0,0,W,H);

  // 1. Hex grid background
  drawHexGrid(ctx, W, H, c, .025 + pulse*.025);

  // 2. Radial glow from centre
  const bg=ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,Math.max(W,H)*.6);
  bg.addColorStop(0, rgb(c, pulse*.12));
  bg.addColorStop(.5, rgb(c, pulse*.04));
  bg.addColorStop(1, 'transparent');
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

  // 3. Particles
  drawParticles(ctx, W, H, c, amp);

  // 4. Neural network edges
  if(jarvisNodes && jarvisEdges) {
    jarvisEdges.forEach(([ai,bi])=>{
      const a=jarvisNodes[ai], b=jarvisNodes[bi];
      const flicker = .05 + pulse*.18 + Math.sin(animT*(1+ai*.3)+bi)*.06;
      ctx.beginPath();
      ctx.strokeStyle=rgb(c, flicker);
      ctx.lineWidth=.5+pulse*.8;
      ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y);
      ctx.stroke();
    });

    // 5. Data streams (animated dots along edges)
    for(let d=0;d<3;d++) drawDataStreams(ctx, jarvisNodes, jarvisEdges, c, pulse);

    // 6. Sparks
    if((currentState==='thinking'||currentState==='speaking'||currentState==='listening')
       && Math.random()<.25+amp*.3){
      const ei=(Math.random()*jarvisEdges.length)|0;
      jarvisSparks.push({ai:jarvisEdges[ei][0],bi:jarvisEdges[ei][1],t:0,spd:.012+Math.random()*.018});
    }
    for(let i=jarvisSparks.length-1;i>=0;i--){
      const sp=jarvisSparks[i]; sp.t+=sp.spd*(1+amp*2);
      if(sp.t>=1){jarvisSparks.splice(i,1);continue;}
      const a=jarvisNodes[sp.ai],b=jarvisNodes[sp.bi];
      const sx=a.x+(b.x-a.x)*sp.t, sy=a.y+(b.y-a.y)*sp.t;
      ctx.beginPath(); ctx.arc(sx,sy,3.5,0,Math.PI*2);
      ctx.fillStyle=rgb(c,.95); ctx.fill();
      const trail=Math.max(0,sp.t-.05);
      const tx=a.x+(b.x-a.x)*trail, ty=a.y+(b.y-a.y)*trail;
      ctx.beginPath(); ctx.arc(tx,ty,1.8,0,Math.PI*2);
      ctx.fillStyle=rgb(c,.4); ctx.fill();
    }

    // 7. Nodes
    jarvisNodes.forEach((n,i)=>{
      const np=pulse+Math.sin(animT+i*.55)*.12;
      const nr=n.r*(1+np*.5);
      const gl=ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,nr*4);
      gl.addColorStop(0,rgb(c,np*.7)); gl.addColorStop(1,'transparent');
      ctx.beginPath(); ctx.arc(n.x,n.y,nr*4,0,Math.PI*2); ctx.fillStyle=gl; ctx.fill();
      ctx.beginPath(); ctx.arc(n.x,n.y,nr,0,Math.PI*2);
      ctx.fillStyle=rgb(c,.8+np*.2); ctx.fill();
    });
  }

  // 8. Concentric rings (over nodes so they look layered)
  drawRings(ctx, W, H, c, amp, pulse);

  // 9. Scan line
  if(currentState !== 'idle') drawScanLine(ctx, W, H, c, amp);

  // 10. Centre hub glow (brightest element)
  const hub = ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,Math.min(W,H)*.07);
  hub.addColorStop(0, rgb(c, pulse*.8+amp*.4));
  hub.addColorStop(1, 'transparent');
  ctx.fillStyle=hub; ctx.fillRect(0,0,W,H);

  return lerpCur;
}

function startNeuronLoop() {
  const smallCanvas = document.getElementById('alec-neuron-small');
  const bigCanvas   = document.getElementById('alec-ov-canvas');
  if (!smallCanvas || !bigCanvas) { setTimeout(startNeuronLoop, 100); return; }

  const ctxS    = smallCanvas.getContext('2d');
  const ctxB    = bigCanvas.getContext('2d');
  const nodesS  = buildSmallNodes(48, 48);
  let lerpS = [99,102,241];
  let lerpB = [99,102,241];
  let tick = 0;

  // Build Jarvis nodes when overlay is first shown (full-screen size)
  function ensureJarvisNodes() {
    const W = window.innerWidth, H = window.innerHeight;
    if (!jarvisNodes || jarvisNodes[0].x !== W*.5) {
      jarvisNodes = buildJarvisNodes(W, H);
      jarvisEdges = buildJarvisEdges(jarvisNodes);
    }
  }

  // Resize big canvas to full window
  function resizeBigCanvas() {
    bigCanvas.width  = window.innerWidth;
    bigCanvas.height = window.innerHeight;
    ensureJarvisNodes();
  }
  resizeBigCanvas();
  window.addEventListener('resize', resizeBigCanvas);

  function frame() {
    requestAnimationFrame(frame);
    animT += (STATE_META[currentState]||STATE_META.idle).speed;

    // Auto-detect thinking from DOM every 10 frames
    if (++tick >= 10) {
      tick = 0;
      if (!isRecording && currentState === 'idle') {
        const hasTyping = !!document.getElementById('typing-indicator');
        const s = (typeof state !== 'undefined' && state.isWaiting) || hasTyping;
        if (s) window.setState('thinking');
      } else if (currentState === 'thinking' && !isRecording) {
        const hasTyping = !!document.getElementById('typing-indicator');
        const s = (typeof state !== 'undefined' && state.isWaiting) || hasTyping;
        if (!s) window.setState('idle');
      }
    }

    const m = STATE_META[currentState] || STATE_META.idle;
    lerpTargetSmall = lerpTargetBig = hexToRgb(m.color);

    // Update overlay glow colour div
    const glow = document.getElementById('alec-ov-glow');
    if (glow) glow.style.background = `radial-gradient(circle at 50% 50%,${m.color}18 0%,transparent 65%)`;

    // Small orb (header strip)
    lerpS = drawSmallNeuron(ctxS, 48, 48, nodesS, lerpS, lerpTargetSmall, m);

    // Full-screen Jarvis HUD (only when overlay is visible)
    const overlay = document.getElementById('alec-overlay');
    if (overlay && overlay.classList.contains('active')) {
      ensureJarvisNodes();
      lerpB = drawJarvisHUD(ctxB, window.innerWidth, window.innerHeight, lerpB, lerpTargetBig, m);
    }
  }
  frame();
}

/* ══════════════════════════════════════════════════════
   HOOK APP.JS GLOBALS
══════════════════════════════════════════════════════ */
function hookAppFunctions() {
  // Override _startCommandCapture so "Hey ALEC" uses the same startMic() flow
  // (overlay, continuous listening, natural restart) instead of the old one-shot capture
  window._startCommandCapture = function() {
    startMic({ conversation: true });    // wake word starts a conversation session
  };

  // addAssistantMessage → source badge + speaking state
  if (typeof addAssistantMessage === 'function') {
    const orig = addAssistantMessage;
    window.addAssistantMessage = function(response) {
      orig(response);
      const msgs = document.getElementById('chat-messages');
      if (!msgs) return;
      const all = msgs.querySelectorAll('.chat-message.assistant');
      const last = all[all.length-1];
      if (!last) return;
      const meta = last.querySelector('.msg-meta');
      if (!meta) return;
      const badge = document.createElement('span');
      badge.className = 'alec-src-badge alec-src-llm';
      badge.textContent = '⚡ Ollama';
      meta.insertBefore(badge, meta.firstChild);
      window.setState('speaking');
      setTimeout(()=>{ if(currentState==='speaking') window.setState('idle'); }, 2500);
    };
  }

  // addTypingIndicator → thinking
  if (typeof addTypingIndicator === 'function') {
    const orig = addTypingIndicator;
    window.addTypingIndicator = function() {
      window.setState('thinking');
      return orig.apply(this, arguments);
    };
  }

  // removeTypingIndicator → idle
  if (typeof removeTypingIndicator === 'function') {
    const orig = removeTypingIndicator;
    window.removeTypingIndicator = function() {
      const r = orig.apply(this, arguments);
      if (currentState==='thinking') window.setState('idle');
      return r;
    };
  }

  // speakResponse → strip emojis/markdown, drive TTS amplitude, auto-resume mic
  if (typeof speakResponse === 'function') {
    const orig = speakResponse;
    window.speakResponse = function(text) {
      window.setState('speaking');
      let iv = setInterval(()=>{ ttsAmp=.25+Math.sin(Date.now()/130)*.2; }, 40);

      const done = () => {
        clearInterval(iv);
        ttsAmp = 0;
        if (currentState === 'speaking') window.setState('idle');

        // Auto-resume listening for follow-up (continuous conversation loop)
        if (conversationActive && !isRecording) {
          _resetConversationTimer();
          // Brief pause so the speaker isn't instantly re-triggered by reverb
          setTimeout(() => {
            if (conversationActive) {
              startMic({ conversation: true });
            }
          }, 700);
        } else if (_wakeWasActive && typeof startVoiceListening === 'function') {
          // If not in conversation mode, restore wake word loop
          _wakeWasActive = false;
          setTimeout(startVoiceListening, 500);
        }
      };

      const p = orig.call(this, cleanForSpeech(text));
      if (p && p.finally) p.finally(done); else setTimeout(done, 8000);
      return p;
    };
  }
}

/* ══════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════ */
function boot() {
  injectStyles();
  injectOverlay();
  injectVoiceStrip();
  injectMicButton();
  startNeuronLoop();
  setTimeout(hookAppFunctions, 150);
}

})();
