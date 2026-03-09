const sceneCanvas = document.getElementById('sceneCanvas');
const sceneCtx = sceneCanvas.getContext('2d', { alpha: false });
const overlayCanvas = document.getElementById('handOverlay');
const overlayCtx = overlayCanvas.getContext('2d');
const videoEl = document.getElementById('inputVideo');
const startCameraBtn = document.getElementById('startCameraBtn');
const demoModeBtn = document.getElementById('demoModeBtn');
const modeButtons = document.querySelectorAll('.mode-btn');

const ui = {
  tracking: document.getElementById('trackingStatus'),
  gesture: document.getElementById('gestureStatus'),
  motion: document.getElementById('motionStatus'),
  energy: document.getElementById('energyStatus'),
  narration: document.getElementById('narrationText'),
  modePill: document.getElementById('modePill'),
  cameraBadge: document.getElementById('cameraBadge'),
  missionTitle: document.getElementById('missionTitle'),
  missionCopy: document.getElementById('missionCopy'),
  missionBadge: document.getElementById('missionBadge'),
  missionProgressBar: document.getElementById('missionProgressBar')
};

const bgCanvas = document.createElement('canvas');
const bgCtx = bgCanvas.getContext('2d');

const handConnections = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17]
];

const missions = [
  {
    title: 'Fase 1 · Detecta tu mano',
    copy: 'Inicia cámara o usa el modo demo. La meta es que el sistema reciba una fuente de movimiento y la traduzca a una interfaz viva.',
    label: 'Detect',
    getProgress: () => (state.handVisible || state.demoMode ? 1 : 0)
  },
  {
    title: 'Fase 2 · Expande la galaxia',
    copy: 'Abre la palma y mantén el gesto el tiempo suficiente para separar órbitas y liberar energía en el núcleo.',
    label: 'Expand',
    getProgress: () => clamp(state.challenge.expandHold / 1.2, 0, 1)
  },
  {
    title: 'Fase 3 · Dispara un pulso',
    copy: 'Haz un movimiento veloz con la mano para provocar un burst. La explosión debe sentirse como una orden física sobre el sistema.',
    label: 'Pulse',
    getProgress: () => clamp(state.challenge.burstHits, 0, 1)
  },
  {
    title: 'Fase 4 · Estabiliza la órbita',
    copy: 'Regresa a un tracking estable. La galaxia debe calmarse y mantener su forma bajo control de tu gesto.',
    label: 'Stabilize',
    getProgress: () => clamp(state.challenge.stableHold / 1.4, 0, 1)
  }
];

const state = {
  width: window.innerWidth,
  height: window.innerHeight,
  dpr: 1,
  mode: 'orbit',
  tracking: 'Esperando',
  gesture: 'Sin mano',
  motion: 'Calmo',
  energy: 'Estable',
  narration:
    'El sistema está listo. Cuando detecte la mano, la escena traducirá movimiento humano en una galaxia reactiva en tiempo real.',
  cameraOnline: false,
  handVisible: false,
  demoMode: true,
  cursor: { x: window.innerWidth * 0.58, y: window.innerHeight * 0.5 },
  cursorTarget: { x: window.innerWidth * 0.58, y: window.innerHeight * 0.5 },
  cursorVelocity: 0,
  gestureMode: 'idle',
  expansion: 1,
  expansionTarget: 1,
  motionBoost: 0,
  burstForce: 0,
  fieldPulse: 0,
  overlayPulse: 0,
  coreHeat: 0.44,
  colorShift: 0,
  lastBurstAt: 0,
  lastCursorSample: { x: window.innerWidth * 0.58, y: window.innerHeight * 0.5, t: performance.now() },
  pointerOverride: false,
  mouse: { x: window.innerWidth * 0.58, y: window.innerHeight * 0.5 },
  lastTime: performance.now(),
  focusEnergy: 0,
  orbitOffset: 0,
  performanceLevel: 'balanced',
  challengeIndex: 0,
  challenge: {
    expandHold: 0,
    burstHits: 0,
    stableHold: 0
  },
  lastLandmarks: null,
  landmarksConfidence: 0,
  autoResetMissionAt: 0
};

const systemCenter = { x: 0, y: 0 };
const stars = [];
const particles = [];
const planets = [];
const shockwaves = [];
const orbitDust = [];

let mediaPipeCamera = null;
let hands = null;
let audioContext = null;

const CONFIG = {
  maxDpr: 1.2,
  maxParticles: 170,
  maxStars: 110,
  planetCount: 4
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(start, end, t) {
  return start + (end - start) * t;
}

function damp(current, target, smoothFactor, dt) {
  return lerp(current, target, 1 - Math.exp(-smoothFactor * dt));
}

function random(min, max) {
  return Math.random() * (max - min) + min;
}

function resizeCanvasToDisplay(canvas, ctx, width, height, dpr) {
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function computeAdaptiveCounts() {
  const area = state.width * state.height;
  const scale = clamp(area / (1600 * 900), 0.72, 1.08);
  const starCount = Math.round(CONFIG.maxStars * scale);
  const particleCount = Math.round(CONFIG.maxParticles * scale);
  return { starCount, particleCount };
}

function resizeScene() {
  state.width = window.innerWidth;
  state.height = window.innerHeight;
  state.dpr = Math.min(window.devicePixelRatio || 1, CONFIG.maxDpr);

  resizeCanvasToDisplay(sceneCanvas, sceneCtx, state.width, state.height, state.dpr);

  const overlayRect = overlayCanvas.getBoundingClientRect();
  const overlayWidth = overlayRect.width || 320;
  const overlayHeight = overlayRect.height || overlayWidth * 0.625;
  resizeCanvasToDisplay(overlayCanvas, overlayCtx, overlayWidth, overlayHeight, 1);

  bgCanvas.width = Math.floor(state.width * state.dpr);
  bgCanvas.height = Math.floor(state.height * state.dpr);
  bgCtx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

  systemCenter.x = state.width * 0.5;
  systemCenter.y = state.height * 0.56;

  buildStaticBackground();
  seedBodies();
}

function buildStaticBackground() {
  const w = state.width;
  const h = state.height;

  bgCtx.clearRect(0, 0, w, h);
  const gradient = bgCtx.createRadialGradient(systemCenter.x, systemCenter.y, 0, systemCenter.x, systemCenter.y, Math.max(w, h) * 0.8);
  gradient.addColorStop(0, 'rgba(10, 16, 34, 0.98)');
  gradient.addColorStop(0.45, 'rgba(4, 7, 18, 0.98)');
  gradient.addColorStop(1, 'rgba(2, 3, 8, 1)');
  bgCtx.fillStyle = gradient;
  bgCtx.fillRect(0, 0, w, h);

  stars.length = 0;
  const counts = computeAdaptiveCounts();
  for (let i = 0; i < counts.starCount; i += 1) {
    const star = {
      x: Math.random() * w,
      y: Math.random() * h,
      size: random(0.6, 2.2),
      alpha: random(0.12, 0.88),
      tint: random(0, 1)
    };
    stars.push(star);
  }

  stars.forEach((star) => {
    bgCtx.globalAlpha = star.alpha;
    bgCtx.fillStyle = star.tint > 0.7 ? 'rgba(255, 212, 170, 1)' : 'rgba(222, 240, 255, 1)';
    bgCtx.beginPath();
    bgCtx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
    bgCtx.fill();
  });
  bgCtx.globalAlpha = 1;

  bgCtx.strokeStyle = 'rgba(116, 215, 255, 0.04)';
  bgCtx.lineWidth = 1;
  for (let i = 0; i < 3; i += 1) {
    const radius = 160 + i * 110;
    bgCtx.beginPath();
    bgCtx.ellipse(systemCenter.x, systemCenter.y, radius, radius * 0.68, 0.1, 0, Math.PI * 2);
    bgCtx.stroke();
  }
}

function seedBodies() {
  particles.length = 0;
  planets.length = 0;
  orbitDust.length = 0;

  const counts = computeAdaptiveCounts();
  const maxRadius = Math.min(state.width, state.height) * 0.33;

  for (let i = 0; i < counts.particleCount; i += 1) {
    const angle = random(0, Math.PI * 2);
    const radius = random(46, maxRadius);
    particles.push({
      x: systemCenter.x + Math.cos(angle) * radius,
      y: systemCenter.y + Math.sin(angle) * radius * 0.78,
      vx: random(-0.22, 0.22),
      vy: random(-0.22, 0.22),
      size: random(1.1, 3.1),
      alpha: random(0.18, 0.9),
      hue: random(190, 290),
      life: random(0.7, 1),
      orbitBias: random(0.8, 1.3),
      drag: random(0.945, 0.975)
    });
  }

  const palette = [
    ['#72dcff', '#3477ff'],
    ['#ffbc75', '#ff7b4f'],
    ['#97ffd9', '#40c791'],
    ['#fdb8ff', '#7b61ff']
  ];

  for (let i = 0; i < CONFIG.planetCount; i += 1) {
    planets.push({
      angle: random(0, Math.PI * 2),
      radius: 120 + i * 74,
      size: 10 + i * 2.8,
      speed: 0.22 + i * 0.04,
      wobble: random(0.8, 1.4),
      trail: [],
      colorA: palette[i][0],
      colorB: palette[i][1]
    });
  }

  for (let i = 0; i < 40; i += 1) {
    orbitDust.push({
      angle: random(0, Math.PI * 2),
      radius: random(90, maxRadius),
      alpha: random(0.05, 0.16),
      size: random(1, 2.4),
      speed: random(0.05, 0.11)
    });
  }
}

function drawSceneBase() {
  sceneCtx.clearRect(0, 0, state.width, state.height);
  sceneCtx.drawImage(bgCanvas, 0, 0, state.width, state.height);
}

function drawOrbitDust(time) {
  sceneCtx.save();
  orbitDust.forEach((dust, index) => {
    const angle = dust.angle + time * 0.00005 * dust.speed * (state.mode === 'nebula' ? 1.4 : 1);
    const px = systemCenter.x + Math.cos(angle + state.orbitOffset * 0.02) * dust.radius * state.expansion;
    const py = systemCenter.y + Math.sin(angle) * dust.radius * 0.74 * state.expansion;
    sceneCtx.globalAlpha = dust.alpha + state.fieldPulse * 0.08;
    sceneCtx.fillStyle = index % 3 === 0 ? 'rgba(255, 200, 150, 1)' : 'rgba(116, 215, 255, 1)';
    sceneCtx.beginPath();
    sceneCtx.arc(px, py, dust.size, 0, Math.PI * 2);
    sceneCtx.fill();
  });
  sceneCtx.restore();
}

function drawNebulaCloud(time) {
  const spread = 250 + state.expansion * 90;
  const pulse = 0.7 + state.fieldPulse * 0.35;
  const leftX = systemCenter.x - 70 + Math.sin(time * 0.0004) * 18;
  const rightX = systemCenter.x + 110 + Math.cos(time * 0.00035) * 22;

  const g1 = sceneCtx.createRadialGradient(leftX, systemCenter.y - 30, 20, leftX, systemCenter.y - 30, spread);
  g1.addColorStop(0, `rgba(118, 221, 255, ${0.22 * pulse})`);
  g1.addColorStop(0.56, 'rgba(94, 138, 255, 0.08)');
  g1.addColorStop(1, 'rgba(94, 138, 255, 0)');
  sceneCtx.fillStyle = g1;
  sceneCtx.fillRect(0, 0, state.width, state.height);

  const g2 = sceneCtx.createRadialGradient(rightX, systemCenter.y + 40, 24, rightX, systemCenter.y + 40, spread * 0.92);
  g2.addColorStop(0, `rgba(190, 134, 255, ${0.18 * pulse})`);
  g2.addColorStop(0.55, 'rgba(118, 85, 255, 0.08)');
  g2.addColorStop(1, 'rgba(118, 85, 255, 0)');
  sceneCtx.fillStyle = g2;
  sceneCtx.fillRect(0, 0, state.width, state.height);
}

function drawCore(time) {
  const pulse = 1 + Math.sin(time * 0.0024) * 0.04 + state.burstForce * 0.18 + state.coreHeat * 0.04;
  const radius = 56 * state.expansion * pulse;
  const glowRadius = 170 + state.fieldPulse * 60 + state.burstForce * 24;

  const glow = sceneCtx.createRadialGradient(systemCenter.x, systemCenter.y, 8, systemCenter.x, systemCenter.y, glowRadius);
  glow.addColorStop(0, 'rgba(255, 247, 198, 0.96)');
  glow.addColorStop(0.2, 'rgba(255, 210, 122, 0.8)');
  glow.addColorStop(0.5, `rgba(255, 135, 72, ${0.24 + state.coreHeat * 0.08})`);
  glow.addColorStop(1, 'rgba(255, 135, 72, 0)');
  sceneCtx.fillStyle = glow;
  sceneCtx.beginPath();
  sceneCtx.arc(systemCenter.x, systemCenter.y, glowRadius, 0, Math.PI * 2);
  sceneCtx.fill();

  const sun = sceneCtx.createRadialGradient(systemCenter.x - radius * 0.18, systemCenter.y - radius * 0.2, radius * 0.1, systemCenter.x, systemCenter.y, radius);
  sun.addColorStop(0, '#fff9c9');
  sun.addColorStop(0.38, '#ffdd84');
  sun.addColorStop(0.72, '#ffae4f');
  sun.addColorStop(1, '#ff6b34');
  sceneCtx.fillStyle = sun;
  sceneCtx.beginPath();
  sceneCtx.arc(systemCenter.x, systemCenter.y, radius, 0, Math.PI * 2);
  sceneCtx.fill();
}

function drawOrbitRings(time) {
  sceneCtx.save();
  sceneCtx.lineWidth = 1.2;
  planets.forEach((planet, index) => {
    const spreadBoost = 1 + state.fieldPulse * 0.05;
    const ringRadius = planet.radius * state.expansion * spreadBoost;
    const cursorInfluence = clamp(220 / (Math.abs(state.cursor.x - systemCenter.x) + 240), 0, 0.42);
    const warp = Math.sin(time * 0.0011 + index + state.orbitOffset * 0.03) * 4 + cursorInfluence * 12;
    sceneCtx.strokeStyle = `rgba(${180 + index * 8}, ${220 - index * 8}, 255, ${0.16 + state.fieldPulse * 0.07})`;
    sceneCtx.beginPath();
    sceneCtx.ellipse(systemCenter.x, systemCenter.y + warp * 0.2, ringRadius, ringRadius * (0.7 + warp * 0.0007), 0.1, 0, Math.PI * 2);
    sceneCtx.stroke();
  });
  sceneCtx.restore();
}

function drawPlanets(delta) {
  planets.forEach((planet, index) => {
    const speedBoost = 1 + state.motionBoost * 0.65 + state.burstForce * 0.12;
    planet.angle += planet.speed * delta * 0.012 * speedBoost;

    const ringRadius = planet.radius * state.expansion;
    const wobble = Math.sin(performance.now() * 0.001 * planet.wobble + index) * 6;
    const px = systemCenter.x + Math.cos(planet.angle + state.orbitOffset * 0.003) * ringRadius;
    const py = systemCenter.y + Math.sin(planet.angle) * ringRadius * 0.72 + wobble;

    const toCursorX = state.cursor.x - px;
    const toCursorY = state.cursor.y - py;
    const cursorDist = Math.hypot(toCursorX, toCursorY) + 1;
    const influence = clamp(180 / cursorDist, 0, 0.9);
    const gx = px + toCursorX * influence * 0.05;
    const gy = py + toCursorY * influence * 0.05;
    const radius = planet.size * (1 + influence * 0.08 + state.burstForce * 0.12);

    planet.trail.push({ x: gx, y: gy });
    if (planet.trail.length > 16) planet.trail.shift();

    sceneCtx.save();
    for (let i = 0; i < planet.trail.length; i += 1) {
      const t = i / planet.trail.length;
      const p = planet.trail[i];
      sceneCtx.globalAlpha = t * 0.18;
      sceneCtx.fillStyle = 'rgba(180, 230, 255, 1)';
      sceneCtx.beginPath();
      sceneCtx.arc(p.x, p.y, radius * 0.34 * t + 0.4, 0, Math.PI * 2);
      sceneCtx.fill();
    }
    sceneCtx.restore();

    const gradient = sceneCtx.createRadialGradient(gx - radius * 0.32, gy - radius * 0.36, radius * 0.12, gx, gy, radius * 1.1);
    gradient.addColorStop(0, planet.colorA);
    gradient.addColorStop(1, planet.colorB);
    sceneCtx.fillStyle = gradient;
    sceneCtx.beginPath();
    sceneCtx.arc(gx, gy, radius, 0, Math.PI * 2);
    sceneCtx.fill();

    sceneCtx.strokeStyle = 'rgba(255,255,255,0.14)';
    sceneCtx.lineWidth = 1;
    sceneCtx.beginPath();
    sceneCtx.arc(gx, gy, radius * 0.72, 0.4, 2.6);
    sceneCtx.stroke();
  });
}

function updateParticles(dt) {
  const closed = state.gestureMode === 'closed';
  const open = state.gestureMode === 'open';

  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    const dx = systemCenter.x - p.x;
    const dy = systemCenter.y - p.y;
    const distCenter = Math.hypot(dx, dy) + 0.001;
    let centerPull = state.mode === 'orbit' ? 0.022 : 0.012;
    let tangential = state.mode === 'orbit' ? 0.016 : 0.03;

    if (open) {
      centerPull *= 0.5;
      tangential *= 1.22;
    }
    if (closed) {
      centerPull *= 1.92;
      tangential *= 0.78;
    }

    const nx = dx / distCenter;
    const ny = dy / distCenter;
    p.vx += nx * centerPull * dt;
    p.vy += ny * centerPull * dt;
    p.vx += -ny * tangential * p.orbitBias * dt;
    p.vy += nx * tangential * p.orbitBias * dt;

    const cdx = state.cursor.x - p.x;
    const cdy = state.cursor.y - p.y;
    const cursorDist = Math.hypot(cdx, cdy) + 1;
    const cursorForce = clamp(180 / cursorDist, 0, 1.45);
    p.vx += (cdx / cursorDist) * cursorForce * (closed ? 0.09 : 0.05) * dt;
    p.vy += (cdy / cursorDist) * cursorForce * (closed ? 0.09 : 0.05) * dt;

    if (open) {
      p.vx -= nx * 0.02 * dt;
      p.vy -= ny * 0.02 * dt;
    }

    if (state.burstForce > 0.02) {
      const bx = p.x - state.cursor.x;
      const by = p.y - state.cursor.y;
      const burstDist = Math.hypot(bx, by) + 1;
      const burst = clamp(state.burstForce * 16 / burstDist, 0, 0.5);
      p.vx += (bx / burstDist) * burst * dt * 1.7;
      p.vy += (by / burstDist) * burst * dt * 1.7;
    }

    p.vx *= p.drag;
    p.vy *= p.drag;
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    const centerDist = Math.hypot(p.x - systemCenter.x, p.y - systemCenter.y);
    const boundary = Math.min(state.width, state.height) * 0.48;
    if (centerDist > boundary) {
      const angle = Math.atan2(p.y - systemCenter.y, p.x - systemCenter.x);
      p.x = systemCenter.x + Math.cos(angle) * boundary * 0.85;
      p.y = systemCenter.y + Math.sin(angle) * boundary * 0.68;
      p.vx *= 0.3;
      p.vy *= 0.3;
    }
  }
}

function drawParticles(time) {
  sceneCtx.save();
  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    const twinkle = 0.68 + Math.sin(time * 0.0022 + i) * 0.18;
    sceneCtx.globalAlpha = p.alpha * p.life * twinkle;
    sceneCtx.fillStyle = `hsla(${p.hue + state.colorShift}, 90%, 72%, 1)`;
    sceneCtx.beginPath();
    sceneCtx.arc(p.x, p.y, p.size + state.fieldPulse * 0.4, 0, Math.PI * 2);
    sceneCtx.fill();
  }
  sceneCtx.restore();
}

function drawShockwaves(dt) {
  for (let i = shockwaves.length - 1; i >= 0; i -= 1) {
    const wave = shockwaves[i];
    wave.life -= 0.022 * dt;
    wave.radius += wave.speed * dt;
    if (wave.life <= 0) {
      shockwaves.splice(i, 1);
      continue;
    }

    sceneCtx.save();
    sceneCtx.globalAlpha = wave.life * 0.45;
    sceneCtx.strokeStyle = wave.color;
    sceneCtx.lineWidth = 2.2;
    sceneCtx.beginPath();
    sceneCtx.arc(wave.x, wave.y, wave.radius, 0, Math.PI * 2);
    sceneCtx.stroke();
    sceneCtx.restore();
  }
}

function drawGravityField(time) {
  const pulse = 1 + Math.sin(time * 0.006 + state.focusEnergy * 2.4) * 0.08;
  const radius = 56 + state.focusEnergy * 34 + state.burstForce * 26;

  sceneCtx.save();
  sceneCtx.globalCompositeOperation = 'screen';
  const field = sceneCtx.createRadialGradient(state.cursor.x, state.cursor.y, 4, state.cursor.x, state.cursor.y, radius * 2.3);
  field.addColorStop(0, 'rgba(255,255,255,0.82)');
  field.addColorStop(0.22, 'rgba(118, 221, 255, 0.34)');
  field.addColorStop(0.5, 'rgba(81, 126, 255, 0.14)');
  field.addColorStop(1, 'rgba(81, 126, 255, 0)');
  sceneCtx.fillStyle = field;
  sceneCtx.beginPath();
  sceneCtx.arc(state.cursor.x, state.cursor.y, radius * 2.3, 0, Math.PI * 2);
  sceneCtx.fill();

  sceneCtx.strokeStyle = `rgba(118, 221, 255, ${0.18 + state.focusEnergy * 0.15})`;
  sceneCtx.lineWidth = 1.4;
  for (let i = 0; i < 2; i += 1) {
    const r = radius * (1 + i * 0.45) * pulse;
    sceneCtx.beginPath();
    sceneCtx.arc(state.cursor.x, state.cursor.y, r, 0, Math.PI * 2);
    sceneCtx.stroke();
  }
  sceneCtx.restore();
}

function drawCursor() {
  sceneCtx.save();
  sceneCtx.globalCompositeOperation = 'screen';
  sceneCtx.strokeStyle = 'rgba(255,255,255,0.86)';
  sceneCtx.lineWidth = 1.2;
  sceneCtx.beginPath();
  sceneCtx.arc(state.cursor.x, state.cursor.y, 8 + state.focusEnergy * 3, 0, Math.PI * 2);
  sceneCtx.stroke();

  sceneCtx.strokeStyle = 'rgba(116, 215, 255, 0.72)';
  sceneCtx.beginPath();
  sceneCtx.moveTo(state.cursor.x - 18, state.cursor.y);
  sceneCtx.lineTo(state.cursor.x + 18, state.cursor.y);
  sceneCtx.moveTo(state.cursor.x, state.cursor.y - 18);
  sceneCtx.lineTo(state.cursor.x, state.cursor.y + 18);
  sceneCtx.stroke();
  sceneCtx.restore();
}

function updateOverlay(dt) {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  overlayCtx.strokeStyle = 'rgba(116, 215, 255, 0.14)';
  overlayCtx.strokeRect(10, 10, overlayCanvas.width - 20, overlayCanvas.height - 20);

  if (!state.lastLandmarks) {
    if (state.demoMode) drawDemoOverlay();
    return;
  }

  const w = overlayCanvas.width;
  const h = overlayCanvas.height;
  overlayCtx.save();
  overlayCtx.lineWidth = 1.6;
  overlayCtx.lineJoin = 'round';
  overlayCtx.lineCap = 'round';

  const points = state.lastLandmarks.map((point) => ({
    x: (1 - point.x) * w,
    y: point.y * h,
    z: point.z || 0
  }));

  overlayCtx.strokeStyle = 'rgba(116, 215, 255, 0.55)';
  handConnections.forEach(([a, b]) => {
    const pa = points[a];
    const pb = points[b];
    overlayCtx.beginPath();
    overlayCtx.moveTo(pa.x, pa.y);
    overlayCtx.lineTo(pb.x, pb.y);
    overlayCtx.stroke();
  });

  points.forEach((p, index) => {
    const isIndex = index === 8;
    const radius = isIndex ? 5.6 : index === 0 ? 4.8 : 3.2;
    overlayCtx.fillStyle = isIndex ? 'rgba(255, 196, 115, 0.96)' : 'rgba(116, 215, 255, 0.9)';
    overlayCtx.beginPath();
    overlayCtx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    overlayCtx.fill();
  });

  const palm = points[9];
  const index = points[8];
  const palmRadius = 18 + state.overlayPulse * 7;
  overlayCtx.strokeStyle = 'rgba(149, 126, 255, 0.5)';
  overlayCtx.lineWidth = 1.4;
  overlayCtx.beginPath();
  overlayCtx.arc(palm.x, palm.y, palmRadius, 0, Math.PI * 2);
  overlayCtx.stroke();

  overlayCtx.strokeStyle = 'rgba(255, 196, 115, 0.58)';
  overlayCtx.beginPath();
  overlayCtx.moveTo(palm.x, palm.y);
  overlayCtx.lineTo(index.x, index.y);
  overlayCtx.stroke();

  overlayCtx.fillStyle = 'rgba(238, 243, 255, 0.86)';
  overlayCtx.font = '700 11px Inter, sans-serif';
  overlayCtx.fillText(state.gesture.toUpperCase(), 18, 24);
  overlayCtx.fillText(`VEL ${state.motion}`, 18, 42);
  overlayCtx.restore();

  state.landmarksConfidence = clamp(state.landmarksConfidence + dt * 2.2, 0, 1);
}

function drawDemoOverlay() {
  const w = overlayCanvas.width;
  const h = overlayCanvas.height;
  const x = w * 0.5 + Math.sin(performance.now() * 0.002) * w * 0.14;
  const y = h * 0.52 + Math.cos(performance.now() * 0.0015) * h * 0.12;

  overlayCtx.save();
  overlayCtx.strokeStyle = 'rgba(116, 215, 255, 0.32)';
  overlayCtx.lineWidth = 1.6;
  overlayCtx.beginPath();
  overlayCtx.arc(x, y, 24, 0, Math.PI * 2);
  overlayCtx.stroke();
  overlayCtx.beginPath();
  overlayCtx.moveTo(x - 28, y);
  overlayCtx.lineTo(x + 28, y);
  overlayCtx.moveTo(x, y - 28);
  overlayCtx.lineTo(x, y + 28);
  overlayCtx.stroke();
  overlayCtx.fillStyle = 'rgba(238, 243, 255, 0.82)';
  overlayCtx.font = '700 11px Inter, sans-serif';
  overlayCtx.fillText('DEMO TRACK', 16, 24);
  overlayCtx.restore();
}

function setNarration(text) {
  state.narration = text;
}

function updateMission() {
  if (state.challengeIndex >= missions.length) {
    ui.missionTitle.textContent = 'Secuencia completa · Sistema estable';
    ui.missionCopy.textContent = 'La experiencia respondió a varios gestos en tiempo real. Ahora puedes repetir la secuencia o cambiar de modo para mostrar otra estética.';
    ui.missionBadge.textContent = '100%';
    ui.missionProgressBar.style.width = '100%';

    if (!state.autoResetMissionAt) {
      state.autoResetMissionAt = performance.now() + 8000;
    }
    if (performance.now() > state.autoResetMissionAt) {
      state.challengeIndex = 0;
      state.challenge.expandHold = 0;
      state.challenge.burstHits = 0;
      state.challenge.stableHold = 0;
      state.autoResetMissionAt = 0;
    }
    return;
  }

  const mission = missions[state.challengeIndex];
  const progress = mission.getProgress();
  ui.missionTitle.textContent = mission.title;
  ui.missionCopy.textContent = mission.copy;
  ui.missionBadge.textContent = `${Math.round(progress * 100)}%`;
  ui.missionProgressBar.style.width = `${Math.round(progress * 100)}%`;

  if (progress >= 1) {
    state.challengeIndex += 1;
  }
}

function updateUI() {
  ui.tracking.textContent = state.tracking;
  ui.gesture.textContent = state.gesture;
  ui.motion.textContent = state.motion;
  ui.energy.textContent = state.energy;
  ui.narration.textContent = state.narration;
  ui.modePill.textContent = state.mode === 'orbit' ? 'Orbit' : 'Nebula';
  ui.cameraBadge.textContent = state.cameraOnline ? 'Live' : state.demoMode ? 'Demo' : 'Offline';
  updateMission();
}

function estimateGesture(landmarks) {
  const wrist = landmarks[0];
  const middleMcp = landmarks[9];
  const span = Math.hypot(wrist.x - middleMcp.x, wrist.y - middleMcp.y) || 0.1;
  const tips = [8, 12, 16, 20].map((index) => landmarks[index]);
  const averageTipDistance = tips.reduce((sum, tip) => sum + Math.hypot(tip.x - wrist.x, tip.y - wrist.y), 0) / tips.length;
  const spread = averageTipDistance / span;

  if (spread > 2.25) return 'open';
  if (spread < 1.62) return 'closed';
  return 'tracking';
}

function triggerBurst(intensity = 1) {
  const now = performance.now();
  if (now - state.lastBurstAt < 520) return;

  state.lastBurstAt = now;
  state.burstForce = Math.min(1.3, 0.52 + intensity * 0.78);
  state.fieldPulse = Math.max(state.fieldPulse, 0.7);
  state.overlayPulse = Math.max(state.overlayPulse, 0.8);
  shockwaves.push({
    x: state.cursor.x,
    y: state.cursor.y,
    radius: 16,
    speed: 8 + intensity * 5.2,
    life: 0.9,
    color: state.mode === 'orbit' ? 'rgba(255, 214, 168, 1)' : 'rgba(163, 140, 255, 1)'
  });

  state.challenge.burstHits = 1;

  if (state.mode === 'orbit') {
    setNarration('Pulse detected. El campo gravitacional liberó una onda que sacudió órbitas y polvo estelar.');
  } else {
    setNarration('Pulse detected. La nebulosa respondió con un estallido cromático y un frente de energía.');
  }

  playPulse(180 + intensity * 80, 0.03, 'triangle');
}

function updateGestureInfo(kind, speed, dt) {
  state.gestureMode = kind;
  state.cursorVelocity = speed;

  if (kind === 'open') {
    state.gesture = 'Palma abierta';
    state.energy = 'Expansión';
    state.expansionTarget = 1.16;
    state.focusEnergy = clamp(state.focusEnergy + dt * 0.7, 0, 1.2);
    state.challenge.expandHold += dt;
    state.challenge.stableHold = 0;
    setNarration('Open hand detected. Las órbitas se separan y el núcleo suelta gravedad para expandir el sistema.');
  } else if (kind === 'closed') {
    state.gesture = 'Puño';
    state.energy = 'Colapso';
    state.expansionTarget = 0.86;
    state.focusEnergy = clamp(state.focusEnergy + dt * 0.45, 0, 1.2);
    state.challenge.stableHold = 0;
    setNarration('Closed hand detected. El núcleo incrementa su atracción y comprime materia alrededor del centro.');
  } else if (kind === 'tracking') {
    state.gesture = 'Tracking estable';
    state.energy = 'Estable';
    state.expansionTarget = 1;
    state.focusEnergy = clamp(state.focusEnergy + dt * 0.24, 0, 1.1);
    if (state.challengeIndex >= 3) {
      state.challenge.stableHold += dt;
    }
    setNarration(
      state.mode === 'orbit'
        ? 'Tracking estable. El índice desplaza un campo gravitacional visible que deforma órbitas y partículas.'
        : 'Tracking estable. Tu mano actúa como pincel cósmico y reorganiza el flujo de la nebulosa.'
    );
  } else {
    state.gesture = 'Sin mano';
    state.energy = state.demoMode ? 'Simulación' : 'En espera';
    state.expansionTarget = 1;
    state.focusEnergy = clamp(state.focusEnergy - dt * 0.5, 0, 1);
    state.challenge.stableHold = 0;
    setNarration(
      state.demoMode
        ? 'Modo demo activo. Un trayecto sintético mantiene viva la experiencia y muestra el comportamiento del sistema.'
        : 'No se detecta mano. Coloca la palma frente a la cámara para iniciar la interacción.'
    );
  }

  state.motion = speed > 1.45 ? 'Burst' : speed > 0.5 ? 'Activo' : 'Calmo';
  state.motionBoost = clamp(speed / 1.3, 0, 1.2);
  state.colorShift = state.mode === 'nebula' ? state.motionBoost * 18 : state.motionBoost * 6;
}

function setMode(mode) {
  state.mode = mode;
  modeButtons.forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  });

  setNarration(
    mode === 'orbit'
      ? 'Modo Orbit activo. El núcleo atrae materia y las órbitas reaccionan con mayor claridad al campo gravitacional de tu mano.'
      : 'Modo Nebula activo. La mano ahora actúa como pincel cósmico para deformar una nube viva de energía y partículas.'
  );
  updateUI();
}

function handleNoResults() {
  state.handVisible = false;
  state.lastLandmarks = null;
  if (!state.demoMode) {
    state.tracking = state.cameraOnline ? 'Buscando mano' : 'Esperando';
    updateGestureInfo('idle', 0, 0.016);
    updateUI();
  }
}

function onResults(results) {
  if (!results.multiHandLandmarks || !results.multiHandLandmarks.length) {
    handleNoResults();
    return;
  }

  const landmarks = results.multiHandLandmarks[0];
  const indexTip = landmarks[8];
  state.lastLandmarks = landmarks;
  state.handVisible = true;
  state.demoMode = false;
  demoModeBtn.textContent = 'Modo demo';

  const newX = (1 - indexTip.x) * state.width;
  const newY = indexTip.y * state.height;

  const now = performance.now();
  const dtMs = Math.max(12, now - state.lastCursorSample.t);
  const dx = newX - state.lastCursorSample.x;
  const dy = newY - state.lastCursorSample.y;
  const speed = Math.hypot(dx, dy) / dtMs;

  state.cursorTarget.x = newX;
  state.cursorTarget.y = newY;
  state.lastCursorSample = { x: newX, y: newY, t: now };
  state.tracking = 'Hand detected';

  const gesture = estimateGesture(landmarks);
  updateGestureInfo(gesture, speed * 5.2, dtMs / 1000);
  if (speed > 1.05) {
    triggerBurst(clamp(speed * 0.64, 0.7, 1.2));
  }
  updateUI();
}

async function initCamera() {
  if (!window.Hands || !window.Camera) {
    state.tracking = 'MediaPipe no disponible';
    setNarration('No fue posible cargar MediaPipe. Usa el modo demo o verifica tu conexión a internet.');
    updateUI();
    return;
  }

  startCameraBtn.disabled = true;
  startCameraBtn.textContent = 'Conectando…';

  try {
    hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.72,
      minTrackingConfidence: 0.66
    });
    hands.onResults(onResults);

    mediaPipeCamera = new Camera(videoEl, {
      onFrame: async () => {
        if (hands) {
          await hands.send({ image: videoEl });
        }
      },
      width: 960,
      height: 540
    });

    await mediaPipeCamera.start();
    state.cameraOnline = true;
    state.demoMode = false;
    state.tracking = 'Cámara activa';
    state.gesture = 'Buscando mano';
    state.energy = 'Inicializando';
    setNarration('Cámara activa. Coloca la mano frente al lente: la malla se dibujará sobre el HUD y el sistema reaccionará en tiempo real.');
    startCameraBtn.textContent = 'Cámara activa';
    updateUI();
  } catch (error) {
    console.error(error);
    startCameraBtn.disabled = false;
    startCameraBtn.textContent = 'Reintentar cámara';
    state.cameraOnline = false;
    enableDemoMode(true);
    state.tracking = 'Permiso denegado';
    setNarration('No se pudo acceder a la cámara. Se activó el modo demo para mantener la experiencia usable.');
    updateUI();
  }
}

function enableDemoMode(setText = true) {
  state.demoMode = true;
  state.handVisible = false;
  state.lastLandmarks = null;
  state.pointerOverride = false;
  state.tracking = state.cameraOnline ? 'Cámara lista' : 'Modo demo';
  updateGestureInfo('idle', 0, 0.016);
  if (setText) {
    setNarration('Modo demo activo. Mueve el mouse para empujar la escena o deja que la trayectoria automática mantenga viva la instalación.');
  }
  demoModeBtn.textContent = 'Modo demo activo';
  updateUI();
}

function updateDemoCursor(time, dt) {
  if (!state.demoMode || state.handVisible) return;

  if (state.pointerOverride) {
    state.cursorTarget.x = state.mouse.x;
    state.cursorTarget.y = state.mouse.y;
    updateGestureInfo('tracking', 0.36, dt);
    updateUI();
    return;
  }

  const x = state.width * 0.5 + Math.sin(time * 0.0007) * state.width * 0.18;
  const y = state.height * 0.5 + Math.cos(time * 0.0009) * state.height * 0.14;
  state.cursorTarget.x = x;
  state.cursorTarget.y = y;

  const speed = 0.5 + (Math.sin(time * 0.0019) + 1) * 0.28;
  const cycle = Math.sin(time * 0.0013);
  let gesture = 'tracking';
  if (cycle > 0.62) gesture = 'open';
  if (cycle < -0.68) gesture = 'closed';
  updateGestureInfo(gesture, speed, dt);

  if (Math.sin(time * 0.0046) > 0.988) {
    triggerBurst(0.8);
  }
  updateUI();
}

function playPulse(frequency, duration, type = 'sine') {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.value = 0.0001;
    oscillator.connect(gain);
    gain.connect(audioContext.destination);

    const now = audioContext.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.016, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.start(now);
    oscillator.stop(now + duration + 0.03);
  } catch (error) {
    console.warn('Audio unavailable', error);
  }
}

function animate(now) {
  requestAnimationFrame(animate);
  const dt = clamp((now - state.lastTime) / 1000, 0.001, 0.033);
  state.lastTime = now;
  const dtNorm = dt * 60;

  updateDemoCursor(now, dt);

  state.cursor.x = damp(state.cursor.x, state.cursorTarget.x, 11, dt);
  state.cursor.y = damp(state.cursor.y, state.cursorTarget.y, 11, dt);
  state.expansion = damp(state.expansion, state.expansionTarget, 7.4, dt);
  state.burstForce = damp(state.burstForce, 0, 4.2, dt);
  state.fieldPulse = damp(state.fieldPulse, clamp(state.motionBoost * 0.5, 0.08, 0.6), 3.8, dt);
  state.overlayPulse = damp(state.overlayPulse, state.handVisible ? 0.36 : 0.14, 5.2, dt);
  state.coreHeat = damp(state.coreHeat, 0.45 + state.motionBoost * 0.18 + (state.gestureMode === 'closed' ? 0.16 : 0), 3, dt);
  state.orbitOffset += state.motionBoost * dtNorm * 0.4;

  drawSceneBase();

  if (state.mode === 'nebula') {
    drawNebulaCloud(now);
  }

  drawOrbitDust(now);
  drawGravityField(now);
  drawCore(now);

  if (state.mode === 'orbit') {
    drawOrbitRings(now);
    drawPlanets(dtNorm);
  }

  updateParticles(dtNorm);
  drawParticles(now);
  drawShockwaves(dtNorm);
  drawCursor();
  updateOverlay(dt);
}

window.addEventListener('resize', () => {
  resizeScene();
  updateUI();
});

sceneCanvas.addEventListener('pointermove', (event) => {
  if (!state.demoMode) return;
  state.pointerOverride = true;
  state.mouse.x = event.clientX;
  state.mouse.y = event.clientY;
});

sceneCanvas.addEventListener('pointerleave', () => {
  state.pointerOverride = false;
});

startCameraBtn.addEventListener('click', async () => {
  await initCamera();
});

demoModeBtn.addEventListener('click', () => {
  enableDemoMode(true);
});

modeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    setMode(button.dataset.mode);
  });
});

resizeScene();
enableDemoMode(false);
setMode('orbit');
updateUI();
requestAnimationFrame(animate);
