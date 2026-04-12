/**
 * A.L.E.C. Neuron Graphic
 *
 * Draws an animated neural network on #neuronCanvas.
 * Pulse speed and color shift based on the current voice state:
 *   idle       → slow blue pulse
 *   listening  → fast cyan pulse
 *   thinking   → frenetic multi-color firing
 *   speaking   → rhythmic green wave
 *   error      → red flash
 *   muted      → dim grey
 */

(function () {
  'use strict';

  const VOICE_STATES = {
    idle: { color: '#6366f1', speed: 0.012, intensity: 0.4 },
    listening: { color: '#06b6d4', speed: 0.04, intensity: 0.9 },
    transcribing: { color: '#06b6d4', speed: 0.06, intensity: 0.8 },
    thinking: { color: '#f59e0b', speed: 0.08, intensity: 1.0 },
    speaking: { color: '#10b981', speed: 0.03, intensity: 0.85 },
    interrupted: { color: '#f97316', speed: 0.1, intensity: 1.0 },
    error: { color: '#ef4444', speed: 0.15, intensity: 1.0 },
    muted: { color: '#475569', speed: 0.006, intensity: 0.2 },
    'offline-fallback': { color: '#6b7280', speed: 0.008, intensity: 0.25 },
  };

  const DEFAULT_STATE = VOICE_STATES.idle;

  // Fixed neuron node positions (normalised 0-1 within 72x72 canvas)
  const NODES = [
    { x: 0.5, y: 0.5 },  // centre — soma
    { x: 0.2, y: 0.25 },
    { x: 0.8, y: 0.25 },
    { x: 0.15, y: 0.65 },
    { x: 0.85, y: 0.65 },
    { x: 0.5, y: 0.12 },
    { x: 0.5, y: 0.88 },
    { x: 0.3, y: 0.78 },
    { x: 0.7, y: 0.78 },
  ];

  // Edges as index pairs
  const EDGES = [
    [0, 1], [0, 2], [0, 3], [0, 4],
    [0, 5], [0, 6], [0, 7], [0, 8],
    [1, 5], [2, 5], [3, 7], [4, 8],
    [1, 3], [2, 4],
  ];

  let canvas, ctx, raf;
  let tick = 0;
  let currentState = DEFAULT_STATE;
  let currentStateName = 'idle';

  // Per-node activation phase offsets so they don't all pulse together
  const phaseOffsets = NODES.map(() => Math.random() * Math.PI * 2);

  function init() {
    canvas = document.getElementById('neuronCanvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    // Respect reduced-motion preference
    const motionOK = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (motionOK) {
      raf = requestAnimationFrame(loop);
    } else {
      drawFrame(0);
    }
  }

  function loop(timestamp) {
    tick += currentState.speed;
    drawFrame(tick);
    raf = requestAnimationFrame(loop);
  }

  function drawFrame(t) {
    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Draw edges
    for (const [a, b] of EDGES) {
      const na = NODES[a];
      const nb = NODES[b];
      const edgePhase = (phaseOffsets[a] + phaseOffsets[b]) / 2;
      const pulse = 0.3 + 0.7 * Math.abs(Math.sin(t + edgePhase));
      const alpha = currentState.intensity * pulse * 0.5;

      ctx.beginPath();
      ctx.moveTo(na.x * W, na.y * H);
      ctx.lineTo(nb.x * W, nb.y * H);
      ctx.strokeStyle = hexToRgba(currentState.color, alpha);
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // Draw nodes
    NODES.forEach((node, i) => {
      const phase = phaseOffsets[i];
      const activation = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.3 + phase));
      const r = (i === 0 ? 7 : 3.5) * (0.7 + 0.3 * activation);
      const alpha = currentState.intensity * activation;

      // Glow
      const grd = ctx.createRadialGradient(
        node.x * W, node.y * H, 0,
        node.x * W, node.y * H, r * 2.5
      );
      grd.addColorStop(0, hexToRgba(currentState.color, alpha * 0.8));
      grd.addColorStop(1, hexToRgba(currentState.color, 0));
      ctx.beginPath();
      ctx.arc(node.x * W, node.y * H, r * 2.5, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();

      // Core dot
      ctx.beginPath();
      ctx.arc(node.x * W, node.y * H, r, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(currentState.color, Math.min(1, alpha * 1.2));
      ctx.fill();
    });
  }

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
  }

  /** Called by app.js when voice state changes */
  window.setNeuronState = function (stateName) {
    currentStateName = stateName;
    currentState = VOICE_STATES[stateName] || DEFAULT_STATE;

    // Update voice state badge
    const badge = document.getElementById('voiceStateBadge');
    const label = document.getElementById('voiceStateText');
    if (badge && label) {
      label.textContent = stateName;
      badge.className = 'voice-state-badge voice-state-' + stateName;
    }

    // Update avatar ring colour via CSS variable
    const ring = document.getElementById('avatarRing');
    if (ring) {
      ring.style.borderColor = currentState.color;
      ring.style.boxShadow = `0 0 12px ${currentState.color}`;
    }
  };

  // Boot after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
