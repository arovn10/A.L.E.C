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

    /* ── Full-screen overlay ── */
    #alec-overlay {
      position:fixed; inset:0; z-index:9999;
      background:rgba(5,8,15,.92);
      backdrop-filter:blur(8px);
      display:flex; flex-direction:column; align-items:center; justify-content:center; gap:24px;
      opacity:0; pointer-events:none;
      transition:opacity .3s ease;
    }
    #alec-overlay.active { opacity:1; pointer-events:all; }
    #alec-ov-canvas { border-radius:50%; display:block; }
    #alec-ov-glow {
      position:absolute; width:380px; height:380px; border-radius:50%;
      background:radial-gradient(circle,rgba(6,182,212,.12) 0%,transparent 70%);
      pointer-events:none; transition:background .5s;
    }
    #alec-ov-label {
      font-size:13px; font-weight:700; letter-spacing:.15em; text-transform:uppercase;
      color:#06b6d4; transition:color .4s;
    }
    #alec-ov-desc { font-size:15px; color:#9ca3af; margin-top:-12px; }
    #alec-ov-transcript {
      font-size:18px; color:#e2e8f0; max-width:560px; text-align:center;
      min-height:28px; font-style:italic; opacity:.7;
    }
    #alec-ov-dismiss {
      padding:8px 24px; border-radius:999px; border:1px solid rgba(255,255,255,.12);
      background:rgba(255,255,255,.05); color:#6b7280; font-size:13px;
      cursor:pointer; transition:all .2s; margin-top:8px;
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

  const canvas = document.createElement('canvas');
  canvas.id = 'alec-ov-canvas';
  canvas.width = 280; canvas.height = 280;

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
  dismiss.textContent = '✕  Cancel';
  dismiss.addEventListener('click', () => {
    overlay.classList.remove('active');
    currentState = 'idle';
    if (typeof setState === 'function') setState('idle');
    // Stop any active recognition
    if (typeof stopMic === 'function') stopMic();
    // Resume wake word loop
    if (typeof _startWakeWordLoop === 'function' && typeof _voiceListening !== 'undefined' && _voiceListening) {
      setTimeout(_startWakeWordLoop, 500);
    }
  });

  overlay.appendChild(glow);
  overlay.appendChild(canvas);
  overlay.appendChild(label);
  overlay.appendChild(desc);
  overlay.appendChild(transcript);
  overlay.appendChild(dismiss);
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

function toggleMic() {
  if (isRecording) { stopMic(); } else { startMic(); }
}

window.stopMic = function stopMic() {
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

function startMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    if (typeof toast === 'function') toast('Voice recognition requires Chrome or Edge.', 'warning');
    return;
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
  if (currentState === 'listening' || currentState === 'transcribing') window.setState('idle');
  if (_wakeWasActive && typeof startVoiceListening === 'function') {
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

// Node positions as fractions of canvas size (works for both 48px and 280px)
const NODE_FRAC = [
  [.50,.50],[.27,.33],[.73,.33],[.20,.58],[.80,.58],
  [.50,.15],[.50,.85],[.08,.25],[.92,.25],
  [.05,.55],[.95,.55],[.27,.78],[.73,.78],
];
const EDGES=[
  [0,1],[0,2],[0,3],[0,4],[0,5],[0,6],
  [1,3],[1,7],[1,5],[2,4],[2,8],[2,5],
  [3,9],[3,6],[4,10],[4,6],
  [5,7],[5,8],[6,11],[6,12],[7,9],[8,10],[9,11],[10,12],
];

function buildNodes(W, H) {
  return NODE_FRAC.map(([fx, fy]) => ({ x: fx*W, y: fy*H, r: Math.max(W/28, 2) + Math.random()*.5 }));
}

let animT = 0;
const sparksSmall = [];
const sparksBig   = [];

function drawNeuron(ctx, W, H, nodes, sparks, lerpCur, lerpTarget, m) {
  lerpCur = lerpC(lerpCur, lerpTarget, 0.06);
  const c = lerpCur;
  const amp = Math.max(micAmp, ttsAmp);
  const pulse = m.intensity + amp*.3 + Math.sin(animT*3.1)*.05*m.jitter*(1+amp);

  ctx.clearRect(0,0,W,H);

  // bg glow
  const bg = ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,W/2);
  bg.addColorStop(0, rgb(c, pulse*.18)); bg.addColorStop(1,'transparent');
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

  // edges
  EDGES.forEach(([ai,bi])=>{
    const a=nodes[ai], b=nodes[bi];
    const jx=(Math.random()-.5)*m.jitter*amp*W*.06;
    const jy=(Math.random()-.5)*m.jitter*amp*H*.06;
    ctx.beginPath();
    ctx.strokeStyle=rgb(c,.08+pulse*.22);
    ctx.lineWidth=Math.max(.3, W/80+pulse*W/40);
    ctx.moveTo(a.x,a.y); ctx.lineTo(b.x+jx,b.y+jy);
    ctx.stroke();
  });

  // sparks
  if((currentState==='thinking'||currentState==='speaking')&&Math.random()<.14){
    const ei=(Math.random()*EDGES.length)|0;
    sparks.push({ai:EDGES[ei][0],bi:EDGES[ei][1],t:0,spd:.016+Math.random()*.02});
  }
  for(let i=sparks.length-1;i>=0;i--){
    const sp=sparks[i]; sp.t+=sp.spd;
    if(sp.t>=1){sparks.splice(i,1);continue;}
    const a=nodes[sp.ai],b=nodes[sp.bi];
    const sx=a.x+(b.x-a.x)*sp.t, sy=a.y+(b.y-a.y)*sp.t;
    const sr=Math.max(1.2,W/22);
    ctx.beginPath(); ctx.arc(sx,sy,sr,0,Math.PI*2);
    ctx.fillStyle=rgb(c,.9); ctx.fill();
    ctx.beginPath(); ctx.arc(sx-(b.x-a.x)*.06,sy-(b.y-a.y)*.06,sr*.6,0,Math.PI*2);
    ctx.fillStyle=rgb(c,.4); ctx.fill();
  }

  // nodes
  nodes.forEach((n,i)=>{
    const np=pulse+Math.sin(animT+i*.7)*.12;
    const nr=n.r*(1+np*.3);
    const gl=ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,nr*3);
    gl.addColorStop(0,rgb(c,np*.55)); gl.addColorStop(1,'transparent');
    ctx.beginPath(); ctx.arc(n.x,n.y,nr*3,0,Math.PI*2); ctx.fillStyle=gl; ctx.fill();
    ctx.beginPath(); ctx.arc(n.x,n.y,nr,0,Math.PI*2);
    ctx.fillStyle=rgb(c,.78+np*.22); ctx.fill();
  });

  return lerpCur;
}

function startNeuronLoop() {
  const smallCanvas = document.getElementById('alec-neuron-small');
  const bigCanvas   = document.getElementById('alec-ov-canvas');
  if (!smallCanvas || !bigCanvas) { setTimeout(startNeuronLoop, 100); return; }

  const ctxS = smallCanvas.getContext('2d');
  const ctxB = bigCanvas.getContext('2d');
  const nodesS = buildNodes(48, 48);
  const nodesB = buildNodes(280, 280);
  let lerpS = [99,102,241];
  let lerpB = [99,102,241];
  let tick = 0;

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

    // Update overlay glow colour
    const glow = document.getElementById('alec-ov-glow');
    if (glow) glow.style.background = `radial-gradient(circle,${m.color}20 0%,transparent 70%)`;

    lerpS = drawNeuron(ctxS, 48,  48,  nodesS, sparksSmall, lerpS, lerpTargetSmall, m);
    lerpB = drawNeuron(ctxB, 280, 280, nodesB, sparksBig,   lerpB, lerpTargetBig,   m);
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
    startMic();
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

  // speakResponse → strip emojis/markdown, drive TTS amplitude
  if (typeof speakResponse === 'function') {
    const orig = speakResponse;
    window.speakResponse = function(text) {
      window.setState('speaking');
      let iv = setInterval(()=>{ ttsAmp=.25+Math.sin(Date.now()/130)*.2; }, 40);
      const done = ()=>{ clearInterval(iv); ttsAmp=0; if(currentState==='speaking') window.setState('idle'); };
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
