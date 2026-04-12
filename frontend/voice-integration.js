/**
 * ALEC Voice Integration
 * Hooks into app.js to add: neuron canvas, source badges, mic button, TTS state visualization.
 * Uses the existing speakResponse (edge-tts via /api/tts) and the REST chat flow.
 */
(function () {
'use strict';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  // Give app.js a tick to define its globals
  setTimeout(boot, 0);
}

/* ══════════════════════════════════════════════════════
   STYLES
══════════════════════════════════════════════════════ */
function injectStyles() {
  const s = document.createElement('style');
  s.id = 'alec-voice-styles';
  if (document.getElementById('alec-voice-styles')) return;
  s.textContent = `
    #alec-voice-strip {
      display:flex; align-items:center; gap:10px;
      padding:8px 16px; flex-shrink:0;
      background:linear-gradient(90deg,rgba(13,20,36,.98),rgba(17,24,39,.98));
      border-bottom:1px solid rgba(30,42,66,.7);
    }
    #alec-neuron-canvas { border-radius:50%; flex-shrink:0; display:block; }
    #alec-state-label {
      font-size:10px; font-weight:700; letter-spacing:.1em;
      text-transform:uppercase; color:#06b6d4; transition:color .4s;
    }
    #alec-state-desc { font-size:11px; color:#6b7280; margin-top:1px; }
    #alec-vol-track {
      width:56px; height:3px; background:rgba(255,255,255,.06);
      border-radius:2px; overflow:hidden; flex-shrink:0;
    }
    #alec-vol-fill {
      height:100%; width:0%;
      background:linear-gradient(90deg,#06b6d4,#6366f1);
      transition:width .05s linear;
    }
    #alec-interim {
      font-size:11px; color:#4b5563; font-style:italic;
      padding:0 16px; max-height:0; overflow:hidden;
      transition:max-height .2s,padding .2s;
      background:rgba(17,24,39,.8);
    }
    #alec-interim.active { max-height:22px; padding:4px 16px; }
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
    .alec-src-badge {
      display:inline-flex; align-items:center; gap:3px;
      padding:1px 7px; border-radius:10px; font-size:10px;
      font-weight:500; margin-right:6px;
    }
    .alec-src-llm          { background:rgba(59,130,246,.12);  border:1px solid rgba(59,130,246,.25);  color:#60a5fa; }
    .alec-src-stoa         { background:rgba(139,92,246,.12);  border:1px solid rgba(139,92,246,.25);  color:#a78bfa; }
    .alec-src-memory       { background:rgba(16,185,129,.12);  border:1px solid rgba(16,185,129,.25);  color:#34d399; }
    .alec-src-correction   { background:rgba(245,158,11,.12);  border:1px solid rgba(245,158,11,.25);  color:#fbbf24; }
    .alec-src-deterministic{ background:rgba(6,182,212,.12);   border:1px solid rgba(6,182,212,.25);   color:#22d3ee; }
    .alec-src-refusal      { background:rgba(239,68,68,.12);   border:1px solid rgba(239,68,68,.25);   color:#f87171; }
  `;
  document.head.appendChild(s);
}

/* ══════════════════════════════════════════════════════
   VOICE STRIP
══════════════════════════════════════════════════════ */
function injectVoiceStrip() {
  const chatPanel = document.getElementById('panel-chat');
  if (!chatPanel || document.getElementById('alec-voice-strip')) return;

  const strip = document.createElement('div');
  strip.id = 'alec-voice-strip';

  const canvas = document.createElement('canvas');
  canvas.id = 'alec-neuron-canvas';
  canvas.width = 48; canvas.height = 48;
  canvas.title = 'Neural activity';

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

  strip.appendChild(canvas);
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
  btn.id = 'alec-mic-btn';
  btn.type = 'button';
  btn.title = 'Voice input';
  btn.setAttribute('aria-label', 'Voice input');
  btn.textContent = '🎤';
  btn.addEventListener('click', toggleMic);

  // Insert before attach button (first child)
  wrapper.insertBefore(btn, wrapper.firstChild);
}

/* ══════════════════════════════════════════════════════
   VOICE STATE
══════════════════════════════════════════════════════ */
let currentState = 'idle';

const STATE_META = {
  idle:         { label:'IDLE',         desc:'Ready — speak or type',         color:'#6366f1', speed:.010, intensity:.22, jitter:.03 },
  listening:    { label:'LISTENING',    desc:'Hearing you…',                  color:'#06b6d4', speed:.040, intensity:.65, jitter:.12 },
  transcribing: { label:'TRANSCRIBING', desc:'Processing speech…',            color:'#3b82f6', speed:.030, intensity:.50, jitter:.08 },
  thinking:     { label:'THINKING',     desc:'ALEC is reasoning…',            color:'#8b5cf6', speed:.060, intensity:.82, jitter:.22 },
  speaking:     { label:'SPEAKING',     desc:'ALEC is responding…',           color:'#10b981', speed:.045, intensity:.72, jitter:.10 },
  interrupted:  { label:'INTERRUPTED',  desc:'Interrupted…',                  color:'#f59e0b', speed:.025, intensity:.42, jitter:.05 },
  error:        { label:'ERROR',        desc:'Something went wrong.',         color:'#ef4444', speed:.012, intensity:.28, jitter:.04 },
};

let lerpTarget = [99, 102, 241];

function setState(s) {
  if (!STATE_META[s]) s = 'idle';
  currentState = s;
  const m = STATE_META[s];
  const label = document.getElementById('alec-state-label');
  const desc  = document.getElementById('alec-state-desc');
  if (label) { label.textContent = m.label; label.style.color = m.color; }
  if (desc)  desc.textContent = m.desc;
  lerpTarget = hexToRgb(m.color);
  updateMicBtn();
}

/* ══════════════════════════════════════════════════════
   MIC LOGIC
══════════════════════════════════════════════════════ */
let isRecording  = false;
let recognition  = null;
let micAmp       = 0;
let ttsAmp       = 0;
let ampInterval  = null;

function toggleMic() {
  if (isRecording) { stopMic(); } else { startMic(); }
}

function startMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    if (typeof toast === 'function') toast('Voice recognition requires Chrome or Edge.', 'warning');
    return;
  }

  // Interrupt any active TTS
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (window._ttsAudio) { try { window._ttsAudio.pause(); } catch(_){} }

  recognition = new SR();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onstart = async () => {
    isRecording = true;
    setState('listening');
    updateMicBtn();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
      startAmpMeter(stream);
    } catch(_){}
  };

  recognition.onend = () => {
    isRecording = false;
    stopAmpMeter();
    updateMicBtn();
    const bar = document.getElementById('alec-interim');
    if (bar) { bar.textContent = ''; bar.classList.remove('active'); }
    if (currentState === 'listening' || currentState === 'transcribing') setState('idle');
  };

  recognition.onerror = (e) => {
    isRecording = false;
    stopAmpMeter();
    updateMicBtn();
    const code = (e && e.error) ? e.error : 'error';
    if (code === 'not-allowed' && typeof toast === 'function')
      toast('Microphone blocked — allow access in browser settings.', 'error');
    setState('idle');
  };

  recognition.onresult = (ev) => {
    let interim = '', final = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      if (ev.results[i].isFinal) final += ev.results[i][0].transcript;
      else interim += ev.results[i][0].transcript;
    }
    const bar = document.getElementById('alec-interim');
    if (interim) {
      setState('transcribing');
      if (bar) { bar.textContent = interim; bar.classList.add('active'); }
      const ci = document.getElementById('chat-input');
      if (ci) ci.value = interim;
    }
    if (final) {
      if (bar) { bar.textContent = ''; bar.classList.remove('active'); }
      const ci = document.getElementById('chat-input');
      if (ci) {
        ci.value = final.trim();
        ci.dispatchEvent(new Event('input'));
      }
      // Mark voice-triggered so app.js fires speakResponse
      if (typeof state !== 'undefined') state._voiceTriggered = true;
      if (typeof sendMessage === 'function') sendMessage();
    }
  };

  try { recognition.start(); }
  catch(e) { if (typeof toast === 'function') toast('Cannot start mic: ' + e.message, 'error'); }
}

function stopMic() {
  if (recognition) { try { recognition.stop(); } catch(_){} }
  stopAmpMeter();
  isRecording = false;
  updateMicBtn();
}

function updateMicBtn() {
  const btn = document.getElementById('alec-mic-btn');
  if (!btn) return;
  btn.classList.remove('listening','speaking','thinking');
  if (isRecording) {
    btn.classList.add('listening'); btn.textContent = '⏹'; btn.title = 'Stop recording';
  } else if (currentState === 'speaking') {
    btn.classList.add('speaking'); btn.textContent = '🔊'; btn.title = 'Speaking…';
  } else if (currentState === 'thinking') {
    btn.classList.add('thinking'); btn.textContent = '🧠'; btn.title = 'Thinking…';
  } else {
    btn.textContent = '🎤'; btn.title = 'Voice input';
  }
}

function startAmpMeter(stream) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const an  = ctx.createAnalyser();
    an.fftSize = 256;
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
  clearInterval(ampInterval);
  micAmp = 0;
  const f = document.getElementById('alec-vol-fill');
  if (f) f.style.width = '0%';
}

/* ══════════════════════════════════════════════════════
   NEURON CANVAS
══════════════════════════════════════════════════════ */
let lerpCur = [99,102,241];
let animT   = 0;
const sparks = [];

const CX=24, CY=24, SC=0.22;
const NODES = [
  {x:0,y:0},{x:-42,y:-28},{x:42,y:-28},{x:-55,y:18},{x:55,y:18},
  {x:0,y:-62},{x:0,y:60},{x:-82,y:-52},{x:82,y:-52},
  {x:-90,y:10},{x:90,y:10},{x:-40,y:72},{x:40,y:72},
].map(p=>({x:CX+p.x*SC, y:CY+p.y*SC, r:2+Math.random()*.8}));

const EDGES=[
  [0,1],[0,2],[0,3],[0,4],[0,5],[0,6],
  [1,3],[1,7],[1,5],[2,4],[2,8],[2,5],
  [3,9],[3,6],[4,10],[4,6],
  [5,7],[5,8],[6,11],[6,12],[7,9],[8,10],[9,11],[10,12],
];

function hexToRgb(h){ const n=parseInt(h.replace('#',''),16); return[(n>>16)&255,(n>>8)&255,n&255]; }
function lerpC(a,b,t){ return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t]; }
function rgb(c,a){ return`rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`; }

function startNeuronLoop() {
  const canvas = document.getElementById('alec-neuron-canvas');
  if (!canvas) { setTimeout(startNeuronLoop, 100); return; }
  const ctx = canvas.getContext('2d');
  let tick = 0;

  function frame() {
    requestAnimationFrame(frame);

    // Auto-detect state every 10 frames
    if (++tick >= 10) {
      tick = 0;
      if (!isRecording) {
        const hasTyping = !!document.getElementById('typing-indicator');
        const s = (typeof state !== 'undefined' && state.isWaiting) || hasTyping;
        if (s && currentState === 'idle') setState('thinking');
        else if (!s && currentState === 'thinking') setState('idle');
      }
    }

    const m = STATE_META[currentState] || STATE_META.idle;
    lerpCur = lerpC(lerpCur, lerpTarget, 0.06);
    const c = lerpCur;
    animT += m.speed;

    const amp = Math.max(micAmp, ttsAmp);
    const pulse = m.intensity + amp*.3 + Math.sin(animT*3.1)*.05*m.jitter*(1+amp);

    ctx.clearRect(0,0,48,48);

    // Background glow
    const bg = ctx.createRadialGradient(CX,CY,0,CX,CY,CX);
    bg.addColorStop(0, rgb(c, pulse*.16));
    bg.addColorStop(1, 'transparent');
    ctx.fillStyle = bg;
    ctx.fillRect(0,0,48,48);

    // Edges
    EDGES.forEach(([ai,bi])=>{
      const a=NODES[ai], b=NODES[bi];
      ctx.beginPath();
      ctx.strokeStyle=rgb(c,.08+pulse*.22);
      ctx.lineWidth=.4+pulse*.7;
      ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y);
      ctx.stroke();
    });

    // Sparks in thinking/speaking
    if((currentState==='thinking'||currentState==='speaking')&&Math.random()<.12){
      const ei=(Math.random()*EDGES.length)|0;
      sparks.push({ai:EDGES[ei][0],bi:EDGES[ei][1],t:0,spd:.018+Math.random()*.02});
    }
    for(let i=sparks.length-1;i>=0;i--){
      const sp=sparks[i]; sp.t+=sp.spd;
      if(sp.t>=1){sparks.splice(i,1);continue;}
      const a=NODES[sp.ai],b=NODES[sp.bi];
      const sx=a.x+(b.x-a.x)*sp.t, sy=a.y+(b.y-a.y)*sp.t;
      ctx.beginPath(); ctx.arc(sx,sy,1.6,0,Math.PI*2);
      ctx.fillStyle=rgb(c,.9); ctx.fill();
    }

    // Nodes
    NODES.forEach((n,i)=>{
      const np=pulse+Math.sin(animT+i*.7)*.1;
      const nr=n.r*(1+np*.3);
      const gl=ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,nr*3);
      gl.addColorStop(0,rgb(c,np*.5)); gl.addColorStop(1,'transparent');
      ctx.beginPath(); ctx.arc(n.x,n.y,nr*3,0,Math.PI*2);
      ctx.fillStyle=gl; ctx.fill();
      ctx.beginPath(); ctx.arc(n.x,n.y,nr,0,Math.PI*2);
      ctx.fillStyle=rgb(c,.75+np*.25); ctx.fill();
    });
  }
  frame();
}

/* ══════════════════════════════════════════════════════
   HOOK APP.JS GLOBALS
══════════════════════════════════════════════════════ */
function hookAppFunctions() {
  // addAssistantMessage → add source badge + set speaking state
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
      setState('speaking');
      setTimeout(()=>{ if(currentState==='speaking') setState('idle'); }, 2500);
    };
  }

  // addTypingIndicator → thinking state
  if (typeof addTypingIndicator === 'function') {
    const orig = addTypingIndicator;
    window.addTypingIndicator = function() {
      setState('thinking');
      return orig.apply(this, arguments);
    };
  }

  // removeTypingIndicator → back to idle
  if (typeof removeTypingIndicator === 'function') {
    const orig = removeTypingIndicator;
    window.removeTypingIndicator = function() {
      const r = orig.apply(this, arguments);
      if (currentState==='thinking') setState('idle');
      return r;
    };
  }

  // speakResponse → TTS amp animation
  if (typeof speakResponse === 'function') {
    const orig = speakResponse;
    window.speakResponse = function(text) {
      setState('speaking');
      let ttsInterval = setInterval(()=>{
        ttsAmp = .25 + Math.sin(Date.now()/130)*.2;
      }, 40);
      const promise = orig.apply(this, arguments);
      const done = ()=>{ clearInterval(ttsInterval); ttsAmp=0; if(currentState==='speaking') setState('idle'); };
      if (promise && promise.finally) promise.finally(done);
      else setTimeout(done, 8000);
      return promise;
    };
  }
}

/* ══════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════ */
function boot() {
  injectStyles();
  injectVoiceStrip();
  injectMicButton();
  startNeuronLoop();

  // Hook after a small delay to ensure app.js has run
  setTimeout(hookAppFunctions, 150);
}

})();
