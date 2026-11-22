// Flick Match - original flick-to-pass soccer game (3D edition)
// The match itself is simulated on a flat 400 x 700 pitch; Three.js draws it in 3D,
// and a transparent 2D canvas on top draws the HUD, aim guides and particles.
import * as THREE from './lib/three.module.min.js';

const overlay = document.getElementById('game');
const ctx = overlay.getContext('2d');
const view3d = document.getElementById('view3d');
const stage = document.getElementById('stage');

const W = 400, H = 700, TAU = Math.PI * 2;
const STEP = 1 / 60; // fixed simulation step, same speed on 60Hz and 120Hz screens
const S = 0.1;       // pitch units -> 3D world units
const BALL_VR = 0.6; // visual ball radius in world units
const GOAL_H = 4.4, NET_DEPTH = 3;

// ---------- Helpers ----------
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const mod = (a, m) => ((a % m) + m) % m;
function lerpAngle(a, b, t) { return a + (mod(b - a + Math.PI, TAU) - Math.PI) * t; }
function easeOutBack(t) { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
function seeded(seed) { return function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); }
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
const wx = x => (x - W / 2) * S; // pitch x -> world X
const wz = y => (y - H / 2) * S; // pitch y -> world Z (your goal is nearest the camera)

// ---------- State ----------
const GOAL_W = 140, GOAL_X = (W - GOAL_W) / 2, NET_D = 14;
let score = { you: 0, cpu: 0 };
let timeLeft = 90;
let message = '', messageTimer = 0, messageStyle = 'white';
let tick = 0;
let celebrate = 0, lastScorer = 'you';
let shake = 0, flashAlpha = 0, flashColor = '#fff', slowMo = 0, endFade = 0;
const scorePop = { you: 0, cpu: 0 };
const net = { top: 0, bottom: 0, hitX: W / 2 };
const particles = [];

const ball = {
  x: W / 2, y: 520, vx: 0, vy: 0, r: 9, owner: null,
  z: 0, vz: 0, spin: 0, dir: -Math.PI / 2, trail: [], px: W / 2, py: 520, pz: 0
};

const KITS = {
  you: { shirt: '#2563eb', short: '#0f172a', trim: '#ffffff', sock: '#f8fafc' },
  cpu: { shirt: '#dc2626', short: '#f8fafc', trim: '#ffffff', sock: '#111827' }
};
const SKIN = ['#f1c27d', '#8d5524', '#c68642', '#e0ac69'];
const HAIR = ['#2b1d0e', '#111111', '#6b4423', '#c9a050'];

function makePlayer(x, y, i, team, extra) {
  return Object.assign({
    x, y, r: 16, team, px: x, py: y, vx: 0, vy: 0,
    face: team === 'you' ? -Math.PI / 2 : Math.PI / 2,
    run: Math.random() * TAU, kick: 0, catchFx: 0, seed: Math.random() * TAU,
    skin: SKIN[i % 4], hair: HAIR[(i * 3 + 1) % 4]
  }, extra);
}

const HOME_YOU = [[200, 560], [90, 470], [310, 470], [200, 380]];
const myTeam = HOME_YOU.map((h, i) => makePlayer(h[0], h[1], i, 'you', { num: [1, 4, 7, 9][i] }));
const cpuTeam = [
  makePlayer(200, 140, 2, 'cpu', { homeX: 200, homeY: 140, num: 1 }),
  makePlayer(110, 230, 3, 'cpu', { homeX: 110, homeY: 230, num: 5 }),
  makePlayer(290, 230, 0, 'cpu', { homeX: 290, homeY: 230, num: 8 }),
  makePlayer(200, 310, 1, 'cpu', { homeX: 200, homeY: 310, num: 10 })
];
const allPlayers = myTeam.concat(cpuTeam);

const DRIBBLE_SPEED = 2.1;   // your carrier when you drag them
const AUTO_RUN_SPEED = 1.6;  // your carrier running on by themselves after receiving
const LEAD_DIST = 35;        // how far ahead of a running teammate a pass is played
const SUPPORT_SPEED = 1.7;   // teammates making runs
const PRESS_SPEED_YOU = 1.5; // your player chasing the CPU carrier
const PRESS_SPEED_CPU = 1.2; // CPU player chasing your carrier
const PROTECT_STEPS = 30;    // no tackles for half a second after getting the ball
let hintTimer = 60 * 8;

function giveBall(p) {
  ball.owner = p;
  ball.vx = 0;
  ball.vy = 0;
  ball.x = p.x;
  ball.y = p.y;
  ball.protect = PROTECT_STEPS;
  ball.passTarget = null;
  ball.passPoint = null;
  ball.autoRun = false;
}
giveBall(myTeam[0]);

function reset(scoredByYou) {
  HOME_YOU.forEach((h, i) => { myTeam[i].x = h[0]; myTeam[i].y = h[1]; });
  cpuTeam.forEach(p => { p.x = p.homeX; p.y = p.homeY; });
  giveBall(scoredByYou ? myTeam[0] : myTeam[0]);
  ball.z = 0; ball.vz = 0; ball.trail.length = 0;
  // No interpolation streaks after teleporting everyone
  allPlayers.forEach(p => { p.px = p.x; p.py = p.y; });
  ball.px = ball.x; ball.py = ball.y; ball.pz = 0;
}

function flash(text, style) {
  message = text;
  messageStyle = style || 'white';
  messageTimer = 90;
}

// ---------- Particles (z is height above the grass, in pitch units) ----------
function spawn(o) {
  if (particles.length > 450) particles.shift();
  const q = Object.assign({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, gz: 0, life: 30, size: 3, color: '#fff', g: 0, drag: 0.92, type: 'dot', rot: 0, vr: 0 }, o);
  q.max = q.life;
  particles.push(q);
}
function puff(x, y, n, vx, vy) {
  for (let i = 0; i < n; i++) {
    spawn({
      x: x + rand(-3, 3), y: y + rand(-2, 4), z: rand(0, 3),
      vx: rand(-1.2, 1.2) - (vx || 0) * 0.08, vy: rand(-1.2, 1.2) - (vy || 0) * 0.08,
      vz: rand(0.2, 1.1), gz: 0.05,
      life: rand(18, 32), size: rand(1.8, 4), drag: 0.9,
      color: Math.random() < 0.6 ? '#d9ecb8' : '#8a6a3c'
    });
  }
}
function ring(x, y, size, color) { spawn({ type: 'ring', x, y, size, color, life: 18 }); }
function confetti(x0, x1, y, dir, n, colors) {
  for (let i = 0; i < n; i++) {
    spawn({
      type: 'confetti', x: rand(x0, x1), y, z: rand(12, 44),
      vx: rand(-2.5, 2.5), vy: dir * rand(0.8, 4.5), vz: rand(0.5, 3), gz: 0.035,
      drag: 0.985, life: rand(90, 160), size: rand(3, 5),
      rot: rand(0, TAU), vr: rand(-0.3, 0.3),
      color: colors[(Math.random() * colors.length) | 0]
    });
  }
}
function sparks(x, y) {
  for (let i = 0; i < 16; i++) {
    const a = rand(0, TAU), s = rand(2, 5.5);
    spawn({ type: 'spark', x, y, z: 18, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rand(-1, 2), gz: 0.08, life: rand(14, 22), drag: 0.88, color: Math.random() < 0.5 ? '#ffd166' : '#ff5a5a' });
  }
  ring(x, y, 34, '#ff5a5a');
}

// ---------- Kicks, catches, goals ----------
function kick(p, vx, vy, power) {
  ball.vx = vx;
  ball.vy = vy;
  ball.lastKicker = p;
  ball.owner = null;
  ball.dir = Math.atan2(vy, vx);
  p.kick = 1;
  p.face = ball.dir;
  // Hard flicks lift the ball off the grass (visual only)
  if (power > 11) {
    ball.vz = (power - 10) * 0.55;
    shake = Math.max(shake, (power - 10) * 0.7);
  }
  puff(ball.x, ball.y, 9, vx, vy);
  ring(ball.x, ball.y, 22, '#ffffff');
}

function catchFx(p) {
  p.catchFx = 1;
  ring(p.x, p.y, 28, p.team === 'you' ? '#ffe14d' : '#ff7b7b');
  puff(p.x, p.y + 6, 4, 0, 0);
}

function goalScored(side) {
  lastScorer = side;
  score[side]++;
  scorePop[side] = 1;
  celebrate = 100;
  slowMo = 30;
  const yours = side === 'you';
  if (yours) net.top = 1; else net.bottom = 1;
  net.hitX = ball.x;
  shake = yours ? 12 : 7;
  flashAlpha = yours ? 0.55 : 0.35;
  flashColor = yours ? '#fff4c2' : '#ff3b3b';
  flash(yours ? 'GOAL!' : 'Conceded', yours ? 'gold' : 'red');
  if (yours) confetti(GOAL_X, GOAL_X + GOAL_W, 12, 1, 150, ['#ffe14d', '#2563eb', '#ffffff', '#60a5fa', '#facc15']);
  else confetti(GOAL_X, GOAL_X + GOAL_W, H - 12, -1, 50, ['#dc2626', '#fecaca', '#ffffff']);
}

// Shared by the real flick and the aiming preview
function computeFlick(owner, dx, dy) {
  const dist = Math.hypot(dx, dy);
  let aimX = dx / dist, aimY = dy / dist;
  let best = null, bestScore = 0;
  for (const mate of myTeam) {
    if (mate === owner) continue;
    const mx = mate.x - owner.x, my = mate.y - owner.y;
    const md = Math.hypot(mx, my);
    if (md < 30) continue;
    // 1 means exactly in the swipe direction, 0 means sideways
    const align = (mx / md) * aimX + (my / md) * aimY;
    if (align > 0.9 && align > bestScore) { best = mate; bestScore = align; }
  }
  let power = Math.min(dist / 12, 14) + 4;
  let point = null;
  if (best) {
    // Lead the pass: play it into the space the teammate is running into
    point = receivePoint(best);
    const mx = point.x - owner.x, my = point.y - owner.y;
    const md = Math.max(1, Math.hypot(mx, my));
    aimX = mx / md;
    aimY = my / md;
    power = Math.max(4, Math.min(md / 28, 14));
  }
  return { aimX, aimY, power, target: best, point };
}

function receivePoint(mate) {
  let dx = 0, dy = -0.4; // always lean toward the opponent's goal
  const sp = Math.hypot(mate.vx, mate.vy);
  if (sp > 0.4) { dx += (mate.vx / sp) * 0.6; dy += (mate.vy / sp) * 0.6; }
  const n = Math.hypot(dx, dy) || 1;
  return {
    x: Math.max(24, Math.min(W - 24, mate.x + (dx / n) * LEAD_DIST)),
    y: Math.max(60, Math.min(H - 60, mate.y + (dy / n) * LEAD_DIST))
  };
}

// ---------- Input: touches are projected onto the 3D pitch ----------
let drag = null;

function pos(e) {
  const rect = overlay.getBoundingClientRect();
  const t = e.touches ? e.touches[0] : e;
  return {
    x: (t.clientX - rect.left) * (W / rect.width),
    y: (t.clientY - rect.top) * (H / rect.height)
  };
}

function down(e) {
  e.preventDefault();
  if (timeLeft <= 0 && celebrate === 0) {
    if (endFade > 0.6) restart();
    return;
  }
  const s = pos(e);
  const g = screenToPitch(s.x, s.y) || { x: ball.x, y: ball.y };
  // Touching your ball carrier starts a dribble; touching anywhere else starts a flick
  const o = ball.owner;
  let mode = 'flick';
  if (o && o.team === 'you') {
    const cs = toScreen(o.x, o.y, 18);
    if (Math.hypot(s.x - cs.x, s.y - cs.y) < 46 || Math.hypot(g.x - o.x, g.y - o.y) < 40) mode = 'dribble';
  }
  drag = { mode, sx: s.x, sy: s.y, cx: s.x, cy: s.y, gx0: g.x, gy0: g.y, gx: g.x, gy: g.y };
}
function move(e) {
  if (!drag) return;
  e.preventDefault();
  const s = pos(e);
  drag.cx = s.x;
  drag.cy = s.y;
  const g = screenToPitch(s.x, s.y);
  if (g) { drag.gx = g.x; drag.gy = g.y; }
}
// A swipe is read as if it were made from your ball carrier: its on-screen direction is projected onto the
// pitch at the carrier, so the same swipe means the same thing anywhere on screen. Power = swipe length.
function dragVec() {
  const sdx = drag.cx - drag.sx, sdy = drag.cy - drag.sy;
  const sd = Math.hypot(sdx, sdy);
  if (sd < 1) return { dx: 0, dy: 0, dist: sd };
  const o = ball.owner;
  const base = o ? toScreen(o.x, o.y, 0) : { x: drag.sx, y: drag.sy };
  const k = 30 / sd;
  const a = screenToPitch(base.x, base.y), b = screenToPitch(base.x + sdx * k, base.y + sdy * k);
  if (!a || !b) return { dx: sdx, dy: sdy, dist: sd };
  const gx = b.x - a.x, gy = b.y - a.y, gd = Math.hypot(gx, gy);
  if (gd < 1e-6) return { dx: sdx, dy: sdy, dist: sd };
  return { dx: (gx / gd) * sd, dy: (gy / gd) * sd, dist: sd };
}
function up(e) {
  if (!drag) return;
  e.preventDefault();
  const v = dragVec();
  const mode = drag.mode;
  drag = null;
  if (mode === 'dribble') return; // letting go: the player runs on by themselves
  if (v.dist < 20 || !ball.owner || ball.owner.team === 'cpu' || celebrate > 0 || timeLeft <= 0) return;
  const f = computeFlick(ball.owner, v.dx, v.dy);
  kick(ball.owner, f.aimX * f.power, f.aimY * f.power, f.power);
  ball.cooldown = 12;
  ball.passTarget = f.target;
  ball.passPoint = f.point;
}

overlay.addEventListener('mousedown', down);
overlay.addEventListener('mousemove', move);
window.addEventListener('mouseup', up);
overlay.addEventListener('touchstart', down, { passive: false });
overlay.addEventListener('touchmove', move, { passive: false });
overlay.addEventListener('touchend', up, { passive: false });

function restart() {
  score = { you: 0, cpu: 0 };
  timeLeft = 90;
  endFade = 0;
  particles.length = 0;
  reset(true);
  hintTimer = 60 * 5;
  flash('KICK OFF', 'white');
}

// ---------- Movement helpers ----------
const clampX = x => Math.max(16, Math.min(W - 16, x));
const clampY = y => Math.max(NET_D + 16, Math.min(H - NET_D - 16, y));

function moveToward(p, tx, ty, speed) {
  const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
  if (d < 1.5) return;
  const s = Math.min(speed, d * 0.2 + 0.3); // ease in to the spot instead of jittering
  p.x = clampX(p.x + (dx / d) * s);
  p.y = clampY(p.y + (dy / d) * s);
}

function nearest(team, x, y, skip) {
  let best = null, bd = Infinity;
  for (const p of team) {
    if (p === skip) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// Where teammate i should run to support the carrier, nudged away from defenders to get open
function supportSpot(i, c, cover) {
  const p = myTeam[i];
  const sway = Math.sin(tick * 0.02 + p.seed * 3) * 22;
  let x, y;
  if (p === cover)  { x = 200 + sway * 0.5; y = Math.max(c.y + 140, 520); } // keeper stays back as cover
  else if (i === 3) { x = 200 + sway * 1.5; y = c.y - 170; } // striker runs in behind
  else if (i === 1) { x = 75 + sway * 0.5;  y = c.y - 95; }  // left wing
  else if (i === 2) { x = 325 + sway * 0.5; y = c.y - 95; }  // right wing
  else              { x = 200 + sway * 0.5; y = c.y - 60; }  // back player joins the attack
  y = Math.max(70, Math.min(620, y));
  for (const d of cpuTeam) {
    const dx = x - d.x, dy = y - d.y, dd = Math.hypot(dx, dy);
    if (dd < 75 && dd > 0.01) { x += (dx / dd) * (75 - dd) * 0.9; y += (dy / dd) * (75 - dd) * 0.5; }
  }
  return { x: clampX(x), y: clampY(y) };
}

// Carry the ball upfield: keep some momentum, drift toward the middle, and swerve around defenders
function autoRun(o) {
  let dx = 0, dy = -1;
  const sp = Math.hypot(o.vx, o.vy);
  if (sp > 0.3) { dx += (o.vx / sp) * 0.6; dy += (o.vy / sp) * 0.6; }
  dx += ((W / 2 - o.x) / 200) * 0.5;
  for (const c of cpuTeam) {
    const ax = o.x - c.x, ay = o.y - c.y, d = Math.hypot(ax, ay);
    if (d < 85 && d > 0.01 && c.y < o.y + 10) {
      const w = ((85 - d) / 85) * 1.6;
      dx += (ax / d) * w;
      dy += (ay / d) * w * 0.5;
    }
  }
  if (o.y < 100) dy = Math.max(0, dy); // don't run into the goal; wait for you to shoot
  const n = Math.hypot(dx, dy);
  if (n < 0.05) return;
  moveToward(o, o.x + (dx / n) * 20, o.y + (dy / n) * 20, AUTO_RUN_SPEED);
}

// Your back player guards the goal: tracks the ball and moves to where a shot will cross
function keeperStep(p) {
  const GK_Y = 612;
  let tx = ball.x;
  if (!ball.owner && ball.vy > 1) {
    const t = (GK_Y - ball.y) / ball.vy;
    if (t > 0) tx = ball.x + ball.vx * t;
  }
  tx = Math.max(GOAL_X - 8, Math.min(GOAL_X + GOAL_W + 8, lerp(W / 2, tx, 0.85)));
  const o = ball.owner;
  const d = Math.hypot(ball.x - p.x, ball.y - p.y);
  if (!o && d < 80) moveToward(p, ball.x, ball.y, 2.2);              // come out to claim a loose ball
  else if (o && o.team === 'cpu' && o.y > 540 && d < 60) moveToward(p, o.x, o.y, 1.6); // smother a striker who gets right in close
  else moveToward(p, tx, GK_Y, 2.2);
}

// The deepest teammate (not the carrier) acts as keeper; stick with the current one unless another is clearly deeper
let keeperRef = null;
function pickKeeper(o) {
  let deepest = null;
  for (const p of myTeam) if (p !== o && (!deepest || p.y > deepest.y)) deepest = p;
  if (!keeperRef || keeperRef === o || deepest.y > keeperRef.y + 40) keeperRef = deepest;
  return keeperRef;
}

function myTeamStep() {
  const o = ball.owner;
  const keeper = pickKeeper(o);

  // Your carrier: drag to steer, otherwise they keep running on with the ball after receiving it
  if (o && o.team === 'you') {
    if (drag && drag.mode === 'dribble') {
      moveToward(o, drag.gx, drag.gy, DRIBBLE_SPEED);
      ball.autoRun = true;
      hintTimer = Math.min(hintTimer, 60);
    } else if (ball.autoRun) {
      autoRun(o);
    }
  }

  const outfield = myTeam.filter(p => p !== keeper);
  const presser = (o && o.team === 'cpu') ? nearest(outfield, o.x, o.y) : null;
  const chaser = !o ? nearest(outfield, ball.x, ball.y, ball.cooldown > 0 ? ball.lastKicker : null) : null;
  // When you attack, the keeper hangs back as cover
  const cover = (o && o.team === 'you') ? keeper : null;

  myTeam.forEach(function (p, i) {
    if (p === o) return;
    if (p === keeper && !(o && o.team === 'you')) { keeperStep(p); return; }
    if (o && o.team === 'you') {
      // Attack: make runs into space ahead of the carrier
      const s = supportSpot(i, o, cover);
      moveToward(p, s.x, s.y, p === cover ? 2.2 : SUPPORT_SPEED);
    } else if (!o) {
      if (ball.passTarget === p) {
        // Receiver keeps running onto the pass, then attacks the ball when it is close
        if (Math.hypot(ball.x - p.x, ball.y - p.y) < 70) moveToward(p, ball.x, ball.y, 2.0);
        else if (ball.passPoint) moveToward(p, ball.passPoint.x, ball.passPoint.y, SUPPORT_SPEED);
      } else if (p === chaser) {
        moveToward(p, ball.x, ball.y, 1.8);
      } else {
        moveToward(p, lerp(HOME_YOU[i][0], ball.x, 0.3), HOME_YOU[i][1], 1.2);
      }
    } else {
      // Defend: nearest player presses the carrier, the rest drop back into shape
      if (p === presser) moveToward(p, o.x, o.y, PRESS_SPEED_YOU);
      else moveToward(p, lerp(HOME_YOU[i][0], o.x, 0.3), HOME_YOU[i][1], 1.3);
    }
  });

  // Keep teammates from stacking on top of each other
  for (let i = 0; i < myTeam.length; i++) {
    for (let j = i + 1; j < myTeam.length; j++) {
      const a = myTeam[i], b = myTeam[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d < 34 && d > 0.01) {
        const push = (34 - d) * 0.25;
        if (a !== o) { a.x = clampX(a.x - (dx / d) * push); a.y = clampY(a.y - (dy / d) * push); }
        if (b !== o) { b.x = clampX(b.x + (dx / d) * push); b.y = clampY(b.y + (dy / d) * push); }
      }
    }
  }
}

// ---------- Simulation ----------
function ballHeight() {
  if (ball.z <= 0 && ball.vz <= 0) return;
  ball.z += ball.vz;
  ball.vz -= 0.32;
  if (ball.z <= 0) {
    ball.z = 0;
    if (ball.vz < -1.5) { ball.vz = -ball.vz * 0.45; puff(ball.x, ball.y, 4, 0, 0); }
    else ball.vz = 0;
  }
}

function gameStep() {
  if (celebrate > 0) { celebrationStep(); return; }
  if (ball.protect > 0) ball.protect--;
  myTeamStep();

  if (ball.owner) {
    // Ball sits at the carrier's feet, on the side they are facing
    const o = ball.owner;
    ball.x = o.x + Math.cos(o.face) * 11;
    ball.y = o.y + Math.sin(o.face) * 11;
    ball.dir = o.face;
    ball.z = 0; ball.vz = 0;
  } else {
    ball.x += ball.vx;
    ball.y += ball.vy;
    ball.vx *= 0.985;
    ball.vy *= 0.985;
    if (ball.cooldown > 0) ball.cooldown--;
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed > 0.15) ball.dir = Math.atan2(ball.vy, ball.vx);
    ballHeight();

    // Side walls bounce
    if (ball.x < ball.r) { ball.x = ball.r; ball.vx *= -0.8; if (speed > 2.5) puff(ball.x, ball.y, 4, 0, 0); }
    if (ball.x > W - ball.r) { ball.x = W - ball.r; ball.vx *= -0.8; if (speed > 2.5) puff(ball.x, ball.y, 4, 0, 0); }

    // Goals: top is the computer's, bottom is yours
    const inGoal = ball.x > GOAL_X && ball.x < GOAL_X + GOAL_W;
    if (ball.y < ball.r) {
      if (inGoal) { goalScored('you'); return; }
      ball.y = ball.r; ball.vy *= -0.8; if (speed > 2.5) puff(ball.x, ball.y, 4, 0, 0);
    }
    if (ball.y > H - ball.r) {
      if (inGoal) { goalScored('cpu'); return; }
      ball.y = H - ball.r; ball.vy *= -0.8; if (speed > 2.5) puff(ball.x, ball.y, 4, 0, 0);
    }

    // Catching: any player touching a slow-enough ball takes it
    if (!(ball.cooldown > 0)) {
      for (const p of allPlayers) {
        const d = Math.hypot(p.x - ball.x, p.y - ball.y);
        if (d < p.r + ball.r) {
          // Faster balls are harder for the computer to catch, giving you room to score
          if (p.team === 'cpu' && speed > 9 && Math.random() < 0.6) continue;
          giveBall(p);
          catchFx(p);
          if (p.team === 'you') ball.autoRun = true; // receive on the run
          break;
        }
      }
    }
  }

  // Simple computer AI
  const youHave = ball.owner && ball.owner.team === 'you';
  const cpuPresser = youHave ? nearest(cpuTeam, ball.owner.x, ball.owner.y) : null;
  // In the CPU's half a second defender also closes in
  const cpuPresser2 = (youHave && ball.owner.y < 380) ? nearest(cpuTeam, ball.owner.x, ball.owner.y, cpuPresser) : null;
  cpuTeam.forEach(function (p) {
    if (youHave) {
      // Defenders close down your carrier, the rest hold their shape and shade toward the ball
      if (p === cpuPresser) moveToward(p, ball.owner.x, ball.owner.y, PRESS_SPEED_CPU);
      else if (p === cpuPresser2) moveToward(p, ball.owner.x, ball.owner.y - 30, 0.9);
      else moveToward(p, lerp(p.homeX, ball.owner.x, 0.25), p.homeY, 1.0);
    } else if (ball.owner && ball.owner !== p) {
      // A teammate has the ball: push forward ahead of them (the deepest player stays back)
      const sway = Math.sin(tick * 0.02 + p.seed * 3) * 25;
      if (p.homeY <= 140) moveToward(p, p.homeX, p.homeY, 1.0);
      else moveToward(p, p.homeX + sway, Math.min(540, ball.owner.y + 90), 1.1);
    } else if (ball.owner === p) {
      const threat = nearest(myTeam, p.x, p.y);
      const pressed = Math.hypot(threat.x - p.x, threat.y - p.y) < 45;
      if (pressed && !(ball.protect > 0)) {
        // Under pressure: pass to the most open teammate further forward, or shoot if close enough
        let mate = null, best = -Infinity;
        for (const m of cpuTeam) {
          if (m === p || m.y < p.y - 10) continue;
          const mark = nearest(myTeam, m.x, m.y);
          const open = Math.hypot(mark.x - m.x, mark.y - m.y);
          const sc = open + (m.y - p.y) * 0.3;
          if (open > 40 && sc > best) { best = sc; mate = m; }
        }
        if (mate) {
          const dx = mate.x - p.x, dy = mate.y - p.y, d = Math.hypot(dx, dy);
          const power = Math.max(4, Math.min(d / 28, 14));
          kick(p, (dx / d) * power, (dy / d) * power, power);
          ball.cooldown = 12;
          return;
        }
        if (p.y > 430) { cpuShoot(p); return; }
      }
      // Dribble toward your goal, then shoot
      p.y += 1.3;
      p.x += (W / 2 - p.x) * 0.01;
      if (p.y > 470 && !(ball.protect > 0)) cpuShoot(p);
    } else {
      // Chase the loose ball a little, otherwise hold position
      const targetX = !ball.owner ? ball.x : p.homeX;
      p.x += Math.max(-1.4, Math.min(1.4, targetX - p.x));
      if (!ball.owner) p.y += Math.max(-1, Math.min(1, (ball.y - p.y) * 0.02));
    }
    p.x = Math.max(p.r, Math.min(W - p.r, p.x));
  });

  // Tackles: touching the opposing carrier wins the ball (not right after they got it)
  if (ball.owner && !(ball.protect > 0)) {
    const o = ball.owner;
    const rivals = o.team === 'you' ? cpuTeam : myTeam;
    for (const c of rivals) {
      if (Math.hypot(c.x - o.x, c.y - o.y) < c.r + o.r - 2) {
        sparks(o.x, o.y);
        giveBall(c);
        c.catchFx = 1;
        if (c.team === 'you') ball.autoRun = true;
        shake = Math.max(shake, 4);
        if (o.team === 'you') flash('Lost it!', 'red');
        else flash('Won it!', 'white');
        break;
      }
    }
  }
}

function cpuShoot(p) {
  const tx = GOAL_X + Math.random() * GOAL_W;
  const dx = tx - p.x, dy = H - p.y;
  const d = Math.hypot(dx, dy);
  kick(p, (dx / d) * 9, (dy / d) * 9, 9);
  ball.cooldown = 15;
}

function celebrationStep() {
  celebrate--;
  // Ball rolls on into the back of the net and settles
  ball.x += ball.vx; ball.y += ball.vy;
  ball.vx *= 0.88; ball.vy *= 0.88;
  ball.y = Math.max(-14, Math.min(H + 14, ball.y));
  ballHeight();
  // Everyone jogs back to their kickoff spots
  if (celebrate < 55) {
    HOME_YOU.forEach((h, i) => { const p = myTeam[i]; p.x = lerp(p.x, h[0], 0.08); p.y = lerp(p.y, h[1], 0.08); });
    cpuTeam.forEach(p => { p.x = lerp(p.x, p.homeX, 0.08); p.y = lerp(p.y, p.homeY, 0.08); });
  }
  if (celebrate === 0) reset(lastScorer === 'you');
}

function animStep() {
  for (const p of allPlayers) {
    p.vx = p.x - p.px;
    p.vy = p.y - p.py;
    const sp = Math.hypot(p.vx, p.vy);
    p.run += 0.12 + sp * 0.3;
    let target;
    if (p === ball.owner && p.team === 'you') {
      target = sp > 0.4 ? Math.atan2(p.vy, p.vx) : -Math.PI / 2;
      if (drag && drag.mode === 'flick') {
        const v = dragVec();
        if (v.dist > 10) { const f = computeFlick(p, v.dx, v.dy); target = Math.atan2(f.aimY, f.aimX); }
      }
    } else if (p === ball.owner) {
      target = sp > 0.2 ? Math.atan2(p.vy, p.vx) : Math.PI / 2;
    } else if (sp > 0.4) {
      target = Math.atan2(p.vy, p.vx);
    } else {
      target = Math.atan2(ball.y - p.y, ball.x - p.x);
    }
    if (p.kick < 0.4) p.face = lerpAngle(p.face, target, 0.18);
    p.kick *= 0.88;
    p.catchFx *= 0.9;
  }
}

function fxStep() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const q = particles[i];
    q.x += q.vx; q.y += q.vy; q.z += q.vz;
    q.vz -= q.gz;
    if (q.z < 0) { q.z = 0; q.vz = 0; q.vx *= 0.8; q.vy *= 0.8; }
    q.vx *= q.drag; q.vy = q.vy * q.drag + q.g;
    q.rot += q.vr;
    if (--q.life <= 0) particles.splice(i, 1);
  }
  const speed = Math.hypot(ball.vx, ball.vy);
  if (!ball.owner && speed > 4.5) ball.trail.push({ x: ball.x, y: ball.y, z: ball.z });
  if (ball.trail.length > 12 || (ball.trail.length && (ball.owner || speed <= 4.5))) ball.trail.shift();

  shake *= 0.88;
  flashAlpha *= 0.9;
  net.top *= 0.96; net.bottom *= 0.96;
  scorePop.you *= 0.9; scorePop.cpu *= 0.9;
  if (messageTimer > 0) messageTimer--;
  if (slowMo > 0) slowMo--;
  if (hintTimer > 0 && celebrate === 0) hintTimer--;
  if (timeLeft <= 0 && celebrate === 0) {
    endFade = Math.min(1, endFade + 0.03);
    if (score.you > score.cpu && tick % 5 === 0) {
      for (let i = 0; i < 3; i++) spawn({ type: 'confetti', x: rand(0, W), y: ball.y + rand(-250, 80), z: 90, vx: rand(-1, 1), vy: rand(-1, 1), gz: 0.03, vz: 0, drag: 0.99, life: 160, size: rand(3, 5), rot: rand(0, TAU), vr: rand(-0.3, 0.3), color: ['#ffe14d', '#2563eb', '#ffffff', '#60a5fa'][i % 4] });
    }
  }
}

function step() {
  tick++;
  ball.px = ball.x; ball.py = ball.y; ball.pz = ball.z;
  for (const p of allPlayers) { p.px = p.x; p.py = p.y; }
  if (timeLeft > 0 && celebrate === 0) timeLeft -= STEP;
  if (timeLeft > 0 || celebrate > 0) gameStep();
  animStep();
  fxStep();
}

// =====================================================================
// 3D scene
// =====================================================================
const renderer = new THREE.WebGLRenderer({ canvas: view3d, antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const SKY = '#0f1d33';
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 80, 170);
const camera = new THREE.PerspectiveCamera(52, W / H, 0.5, 300);

scene.add(new THREE.HemisphereLight('#dfe9ff', '#2d4a22', 1.15));
const sun = new THREE.DirectionalLight('#fff4e0', 2.3);
sun.position.set(18, 48, 24);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 48, bottom: -48, near: 5, far: 130 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun);

const matCache = {};
const M = c => matCache[c] || (matCache[c] = new THREE.MeshStandardMaterial({ color: c, roughness: 0.75 }));

function canvasTexture(c, repeatX) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (repeatX) { t.wrapS = THREE.RepeatWrapping; t.repeat.set(repeatX, 1); }
  return t;
}

// ----- Pitch -----
function makePitchCanvas() {
  const c = document.createElement('canvas');
  const k = 2.56;
  c.width = Math.round(W * k); c.height = Math.round(H * k);
  const g = c.getContext('2d');
  g.setTransform(k, 0, 0, k, 0, 0);
  for (let i = 0; i < 14; i++) { g.fillStyle = i % 2 ? '#2a8a3e' : '#319a47'; g.fillRect(0, i * 50, W, 50); }
  const r = seeded(7);
  for (let i = 0; i < 6000; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
    g.fillRect(r() * W, r() * H, 0.6, r() * 2 + 0.6);
  }
  g.strokeStyle = 'rgba(255,255,255,0.92)';
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.lineWidth = 1.6;
  g.strokeRect(10, 10, W - 20, H - 20);
  g.beginPath(); g.moveTo(10, H / 2); g.lineTo(W - 10, H / 2); g.stroke();
  g.beginPath(); g.arc(W / 2, H / 2, 50, 0, TAU); g.stroke();
  g.beginPath(); g.arc(W / 2, H / 2, 2.5, 0, TAU); g.fill();
  const da = Math.acos(25 / 45);
  [true, false].forEach(function (top) {
    g.strokeRect(80, top ? 10 : H - 110, 240, 100);
    g.strokeRect(140, top ? 10 : H - 45, 120, 35);
    const spotY = top ? 85 : H - 85;
    g.beginPath(); g.arc(W / 2, spotY, 2, 0, TAU); g.fill();
    g.beginPath();
    if (top) g.arc(W / 2, spotY, 45, Math.PI / 2 - da, Math.PI / 2 + da);
    else g.arc(W / 2, spotY, 45, -Math.PI / 2 - da, -Math.PI / 2 + da);
    g.stroke();
  });
  [[10, 10, 0], [W - 10, 10, Math.PI / 2], [W - 10, H - 10, Math.PI], [10, H - 10, Math.PI * 1.5]].forEach(function (cn) {
    g.beginPath(); g.arc(cn[0], cn[1], 8, cn[2], cn[2] + Math.PI / 2); g.stroke();
  });
  return c;
}

const groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(170, 210), new THREE.MeshStandardMaterial({ color: '#226b33', roughness: 1 }));
groundMesh.rotation.x = -Math.PI / 2;
groundMesh.position.y = -0.02;
groundMesh.receiveShadow = true;
scene.add(groundMesh);

const pitchMesh = new THREE.Mesh(new THREE.PlaneGeometry(W * S, H * S), new THREE.MeshStandardMaterial({ map: canvasTexture(makePitchCanvas()), roughness: 0.95 }));
pitchMesh.rotation.x = -Math.PI / 2;
pitchMesh.receiveShadow = true;
scene.add(pitchMesh);

// ----- Stadium: stands with a crowd, LED boards, floodlights -----
function crowdCanvas() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#1a2233'; g.fillRect(0, 0, 512, 160);
  const r = seeded(11);
  const cols = ['#e5e7eb', '#2563eb', '#dc2626', '#facc15', '#1f2937', '#60a5fa', '#f97316', '#a3a3a3'];
  for (let row = 0; row < 16; row++) {
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, row * 10 + 8, 512, 2);
    for (let x = 2; x < 510; x += 5) {
      if (r() < 0.12) continue;
      g.fillStyle = cols[(r() * cols.length) | 0];
      g.fillRect(x + r(), row * 10 + 1 + r() * 2, 3.2, 5.5);
      g.fillStyle = '#e0b48a'; g.fillRect(x + 0.6, row * 10, 2, 2);
    }
  }
  return c;
}
function boardCanvas() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 32;
  const g = c.getContext('2d');
  const panels = [['#1d4ed8', '#ffffff'], ['#111827', '#facc15'], ['#b91c1c', '#ffffff'], ['#047857', '#ffffff']];
  for (let i = 0; i < 4; i++) {
    g.fillStyle = panels[i][0]; g.fillRect(i * 128, 0, 128, 32);
    g.fillStyle = panels[i][1]; g.font = 'bold 17px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(i % 2 ? 'FLICK  MATCH' : 'PASS  &  SCORE', i * 128 + 64, 17);
  }
  return c;
}
const crowdTex = canvasTexture(crowdCanvas(), 3);
const boardTex = canvasTexture(boardCanvas(), 3);
const standSide = M('#283247');
function addStand(x, z, len, rotY) {
  const holder = new THREE.Group();
  holder.position.set(x, 0, z);
  holder.rotation.y = rotY;
  const crowd = new THREE.MeshStandardMaterial({ map: crowdTex, roughness: 0.9 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(len, 16, 2), [standSide, standSide, standSide, standSide, crowd, standSide]);
  box.position.set(0, 7, 0);
  box.rotation.x = -0.55; // lean back so the crowd faces the pitch
  holder.add(box);
  const base = new THREE.Mesh(new THREE.BoxGeometry(len, 2.2, 3), M('#1b2333'));
  base.position.set(0, 1.1, 3.5);
  holder.add(base);
  scene.add(holder);
}
addStand(0, -52, 70, 0);
addStand(0, 52, 70, Math.PI);
addStand(33, 0, 110, -Math.PI / 2);
addStand(-33, 0, 110, Math.PI / 2);

function addBoard(x, z, len, rotY) {
  const mat = new THREE.MeshBasicMaterial({ map: boardTex });
  const b = new THREE.Mesh(new THREE.BoxGeometry(len, 0.9, 0.2), [M('#111'), M('#111'), M('#111'), M('#111'), mat, M('#111')]);
  b.position.set(x, 0.45, z);
  b.rotation.y = rotY;
  b.castShadow = true;
  scene.add(b);
}
addBoard(0, -40, 46, 0);
addBoard(0, 40, 46, Math.PI);
addBoard(22.5, 0, 82, -Math.PI / 2);
addBoard(-22.5, 0, 82, Math.PI / 2);

[[-29, -47], [29, -47], [-29, 47], [29, 47]].forEach(function (pp) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 30, 8), M('#4b5563'));
  pole.position.set(pp[0], 15, pp[1]);
  scene.add(pole);
  const head = new THREE.Mesh(new THREE.BoxGeometry(4.5, 2.2, 0.6), new THREE.MeshBasicMaterial({ color: '#fffbe6' }));
  head.position.set(pp[0], 30.5, pp[1]);
  head.lookAt(0, 0, 0);
  scene.add(head);
});

// ----- Goals with rippling nets -----
const netMat = new THREE.MeshBasicMaterial({ color: '#ffffff', wireframe: true, transparent: true, opacity: 0.55 });
const netFill = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false });
function makeGoal(top) {
  const group = new THREE.Group();
  const zLine = wz(top ? 10 : H - 10);
  const dir = top ? -1 : 1; // net extends away from the pitch
  const gw = GOAL_W * S;
  const white = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35 });
  const postGeo = new THREE.CylinderGeometry(0.14, 0.14, GOAL_H, 12);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, white);
    post.position.set(sx * gw / 2, GOAL_H / 2, zLine);
    post.castShadow = true;
    group.add(post);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, gw + 0.28, 12), white);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, GOAL_H, zLine);
  bar.castShadow = true;
  group.add(bar);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(gw, GOAL_H, 28, 9), netMat);
  back.position.set(0, GOAL_H / 2, zLine + dir * NET_DEPTH);
  group.add(back);
  const backFill = new THREE.Mesh(back.geometry, netFill);
  back.add(backFill);
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(gw, NET_DEPTH, 28, 6), netMat);
  roof.rotation.x = Math.PI / 2;
  roof.position.set(0, GOAL_H, zLine + dir * NET_DEPTH / 2);
  group.add(roof);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(NET_DEPTH, GOAL_H, 6, 9), netMat);
    side.rotation.y = Math.PI / 2;
    side.position.set(sx * gw / 2, GOAL_H / 2, zLine + dir * NET_DEPTH / 2);
    group.add(side);
  }
  scene.add(group);
  return { back, base: back.geometry.attributes.position.array.slice(), dir, top, rippling: false };
}
const goals = [makeGoal(true), makeGoal(false)];

function updateNet(goal) {
  const amp = goal.top ? net.top : net.bottom;
  const attr = goal.back.geometry.attributes.position;
  if (amp < 0.01) {
    if (goal.rippling) { attr.array.set(goal.base); attr.needsUpdate = true; goal.rippling = false; }
    return;
  }
  goal.rippling = true;
  const hit = wx(net.hitX);
  for (let i = 0; i < attr.count; i++) {
    const bx = goal.base[i * 3], by = goal.base[i * 3 + 1];
    const bulge = amp * Math.exp(-((bx - hit) * (bx - hit)) / 10) * (0.65 + 0.35 * Math.sin(tick * 0.5 + by * 2));
    attr.array[i * 3 + 2] = goal.base[i * 3 + 2] + goal.dir * bulge * 1.6; // push outward, away from the pitch
  }
  attr.needsUpdate = true;
}

// ----- Players: jointed figures built from simple shapes -----
const GEO = {
  torso: new THREE.CapsuleGeometry(0.42, 0.55, 4, 12),
  shorts: new THREE.BoxGeometry(0.9, 0.42, 0.52),
  thigh: new THREE.CapsuleGeometry(0.19, 0.42, 4, 8),
  shin: new THREE.CapsuleGeometry(0.16, 0.5, 4, 8),
  boot: new THREE.BoxGeometry(0.28, 0.2, 0.52),
  upperArm: new THREE.CapsuleGeometry(0.15, 0.32, 4, 8),
  foreArm: new THREE.CapsuleGeometry(0.12, 0.36, 4, 8),
  head: new THREE.SphereGeometry(0.36, 16, 12),
  hair: new THREE.SphereGeometry(0.385, 16, 8, 0, TAU, 0, Math.PI * 0.55),
  neck: new THREE.CylinderGeometry(0.13, 0.15, 0.22, 8),
  num: new THREE.PlaneGeometry(0.5, 0.5)
};

function numberMaterial(n, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 46px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(String(n), 32, 35);
  return new THREE.MeshStandardMaterial({ map: canvasTexture(c), transparent: true, alphaTest: 0.4, roughness: 0.8 });
}

function buildPlayer(p) {
  const kit = KITS[p.team];
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const add = (parent, geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const HIP = 1.5;
  const legs = [], arms = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(side * 0.24, HIP, 0); body.add(hip);
    add(hip, GEO.thigh, M(p.skin), 0, -0.35, 0);
    const knee = new THREE.Group(); knee.position.set(0, -0.72, 0); hip.add(knee);
    add(knee, GEO.shin, M(kit.sock), 0, -0.33, 0);
    add(knee, GEO.boot, M('#151515'), 0, -0.7, 0.1);
    legs.push({ hip, knee });
  }
  add(body, GEO.shorts, M(kit.short), 0, HIP + 0.05, 0);
  const torso = add(body, GEO.torso, M(kit.shirt), 0, HIP + 0.75, 0);
  torso.scale.set(1, 1, 0.7);
  const num = new THREE.Mesh(GEO.num, numberMaterial(p.num, kit.trim));
  num.position.set(0, HIP + 0.95, -0.31);
  num.rotation.y = Math.PI;
  body.add(num);
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group(); shoulder.position.set(side * 0.58, HIP + 1.25, 0); body.add(shoulder);
    add(shoulder, GEO.upperArm, M(kit.shirt), 0, -0.25, 0);
    const elbow = new THREE.Group(); elbow.position.set(0, -0.52, 0); shoulder.add(elbow);
    add(elbow, GEO.foreArm, M(p.skin), 0, -0.26, 0);
    arms.push({ shoulder, elbow });
  }
  add(body, GEO.neck, M(p.skin), 0, HIP + 1.52, 0);
  add(body, GEO.head, M(p.skin), 0, HIP + 1.84, 0);
  const hair = add(body, GEO.hair, M(p.hair), 0, HIP + 1.87, -0.03);
  hair.rotation.x = -0.3;
  scene.add(root);
  return { root, body, legs, arms };
}
const playerMeshes = allPlayers.map(buildPlayer);

function updatePlayerMesh(p, m, x, y) {
  const sp = Math.min(1, Math.hypot(p.vx, p.vy) / 1.3);
  const swing = Math.sin(p.run) * sp;
  const hop = (celebrate > 40 && p.team === lastScorer) ? Math.abs(Math.sin(tick * 0.22 + p.seed)) : 0;
  m.root.position.set(wx(x), 0, wz(y));
  m.root.rotation.y = Math.PI / 2 - p.face; // model faces +Z; pitch angle 0 points along +X
  m.body.position.y = hop * 0.9;
  m.body.rotation.x = sp * 0.18; // lean into the run
  m.body.scale.y = 1 + Math.sin(tick * 0.07 + p.seed) * 0.012;
  for (let k = 0; k < 2; k++) {
    const side = k ? 1 : -1;
    const L = m.legs[k];
    let a = side * swing * 0.75;
    if (k === 1 && p.kick > 0.05) a = lerp(a, -1.5, p.kick); // right leg swings through on a kick
    L.hip.rotation.x = a;
    L.knee.rotation.x = Math.max(0, Math.sin(p.run + (k ? Math.PI : 0))) * sp * 0.9 + (k === 1 ? p.kick * 0.25 : 0);
    const A = m.arms[k];
    A.shoulder.rotation.x = -side * swing * 0.7 + (hop ? -2.7 : 0);
    A.shoulder.rotation.z = side * (0.12 + (hop ? 0.35 : 0));
    A.elbow.rotation.x = -0.25 - 0.55 * sp;
  }
}

// ----- Ball -----
function ballCanvas() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f8fafc'; g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#111827';
  g.fillRect(0, 0, 512, 16); g.fillRect(0, 240, 512, 16);
  const pent = (cx, cy, r) => {
    g.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * TAU / 5;
      if (i) g.lineTo(cx + Math.cos(a) * r * 1.25, cy + Math.sin(a) * r); else g.moveTo(cx + Math.cos(a) * r * 1.25, cy + Math.sin(a) * r);
    }
    g.closePath(); g.fill();
  };
  for (let i = 0; i < 5; i++) { pent(i * 102.4 + 20, 82, 24); pent(i * 102.4 + 71, 174, 24); }
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2;
  for (let i = 0; i < 10; i++) { g.beginPath(); g.moveTo(i * 51.2, 30); g.lineTo(i * 51.2 + 25, 128); g.lineTo(i * 51.2, 226); g.stroke(); }
  return c;
}
const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_VR, 32, 20), new THREE.MeshStandardMaterial({ map: canvasTexture(ballCanvas()), roughness: 0.35 }));
ballMesh.castShadow = true;
scene.add(ballMesh);
const rollAxis = new THREE.Vector3();
let lastBallW = null;

// ----- Ground rings: carrier marker and pooled effect rings -----
const carrierRing = new THREE.Group();
const carrierMat = new THREE.MeshBasicMaterial({ color: '#ffe14d', transparent: true, opacity: 0.95, depthWrite: false });
for (let i = 0; i < 8; i++) {
  const seg = new THREE.Mesh(new THREE.RingGeometry(1.95, 2.3, 6, 1, i * TAU / 8, (TAU / 8) * 0.6), carrierMat);
  seg.rotation.x = -Math.PI / 2;
  carrierRing.add(seg);
}
carrierRing.position.y = 0.04;
scene.add(carrierRing);

const ringPool = [];
const ringGeo = new THREE.RingGeometry(0.82, 1, 40);
for (let i = 0; i < 14; i++) {
  const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.05;
  m.visible = false;
  scene.add(m);
  ringPool.push(m);
}

// ----- Camera follows the ball from behind your team -----
const camT = { x: 0, z: 15 };
function updateCamera(bx, by, dt) {
  const tx = wx(bx) * 0.7;
  const tz = Math.max(-25, Math.min(24, wz(by)));
  const k = 1 - Math.exp(-dt * 3.2);
  camT.x = lerp(camT.x, tx, k);
  camT.z = lerp(camT.z, tz, k);
  let sx = 0, sy = 0;
  if (shake > 0.3) { sx = rand(-1, 1) * shake * 0.05; sy = rand(-1, 1) * shake * 0.05; }
  camera.position.set(camT.x * 0.8 + sx, 30 + sy, camT.z + 29);
  camera.lookAt(camT.x, 0, camT.z - 8);
  camera.updateMatrixWorld();
}

// ----- Projection helpers between pitch, world and screen -----
const _v = new THREE.Vector3(), _vv = new THREE.Vector3(), _ndc = new THREE.Vector2(), _hit = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let focal = 1;
function toScreen(px, py, h) {
  _v.set(wx(px), (h || 0) * S, wz(py));
  _vv.copy(_v).applyMatrix4(camera.matrixWorldInverse);
  const depth = -_vv.z;
  _v.project(camera);
  return { x: (_v.x + 1) / 2 * W, y: (1 - _v.y) / 2 * H, ppu: depth > 0.1 ? (focal * S) / depth : 0, ok: depth > 0.1 };
}
function screenToPitch(sx, sy) {
  _ndc.set((sx / W) * 2 - 1, -((sy / H) * 2 - 1));
  raycaster.setFromCamera(_ndc, camera);
  if (!raycaster.ray.intersectPlane(groundPlane, _hit)) return null;
  return { x: _hit.x / S + W / 2, y: _hit.z / S + H / 2 };
}
function groundArc(px, py, r, a0, a1) {
  ctx.beginPath();
  const n = 28;
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    const s = toScreen(px + Math.cos(a) * r, py + Math.sin(a) * r, 0);
    if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y);
  }
}

// ---------- Display ----------
let viewK = 1;
function fit() {
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const cw = Math.max(1, Math.floor(W * s)), ch = Math.max(1, Math.floor(H * s));
  stage.style.width = cw + 'px';
  stage.style.height = ch + 'px';
  renderer.setPixelRatio(Math.min(dpr, 2));
  renderer.setSize(cw, ch, false);
  viewK = (cw / W) * dpr;
  overlay.width = Math.max(1, Math.round(W * viewK));
  overlay.height = Math.max(1, Math.round(H * viewK));
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  focal = (H / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
}
window.addEventListener('resize', fit);
fit();

// ---------- Overlay drawing (2D on top of the 3D view) ----------
function drawTrail() {
  const n = ball.trail.length;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < n; i++) {
    const t = ball.trail[i], k = (i + 1) / n;
    const s = toScreen(t.x, t.y, (BALL_VR + t.z * 0.25) / S);
    if (!s.ok) continue;
    ctx.globalAlpha = k * 0.3;
    circle(s.x, s.y, (BALL_VR / S) * s.ppu * k * 0.85); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawParticles() {
  for (const q of particles) {
    if (q.type === 'ring') continue; // drawn in 3D
    const s = toScreen(q.x, q.y, q.z);
    if (!s.ok) continue;
    const k = q.life / q.max;
    ctx.globalAlpha = Math.min(1, k * 1.6);
    if (q.type === 'confetti') {
      const sz = q.size * s.ppu;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(q.rot);
      ctx.scale(1, Math.cos(q.rot * 1.7));
      ctx.fillStyle = q.color;
      ctx.fillRect(-sz / 2, -sz * 0.3, sz, sz * 0.6);
      ctx.restore();
    } else if (q.type === 'spark') {
      const e = toScreen(q.x - q.vx * 2.5, q.y - q.vy * 2.5, q.z - q.vz * 2.5);
      ctx.strokeStyle = q.color;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke();
    } else {
      ctx.fillStyle = q.color;
      circle(s.x, s.y, Math.max(0.6, q.size * s.ppu * (0.4 + 0.6 * k))); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function updateRings() {
  let n = 0;
  for (const q of particles) {
    if (q.type !== 'ring' || n >= ringPool.length) continue;
    const m = ringPool[n++];
    const k = q.life / q.max;
    m.visible = true;
    m.position.set(wx(q.x), 0.05, wz(q.y));
    m.scale.setScalar((4 + q.size * (1 - k)) * S);
    m.material.color.set(q.color);
    m.material.opacity = k;
  }
  for (; n < ringPool.length; n++) ringPool[n].visible = false;
}

function drawAim(o, ox, oy, bx, by) {
  const v = dragVec();
  if (v.dist < 8) return;
  const f = computeFlick(o, v.dx, v.dy);
  ctx.save();
  ctx.globalAlpha = v.dist >= 20 ? 1 : 0.4;
  ctx.lineCap = 'round';
  if (f.target) {
    // Snapped pass: dotted path along the grass to where the teammate is running, plus a ring on them
    const qx = f.point.x, qy = f.point.y;
    const qd = Math.hypot(qx - bx, qy - by);
    const offset = (tick * 0.8) % 12;
    for (let d = 14 + offset; d < qd - 8; d += 12) {
      const k = d / qd;
      const s = toScreen(bx + (qx - bx) * k, by + (qy - by) * k, 0);
      ctx.fillStyle = 'rgba(255,255,255,' + (0.95 - 0.5 * k) + ')';
      circle(s.x, s.y, Math.max(2, 2.6 * s.ppu)); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    groundArc(qx, qy, 6, 0, TAU); ctx.stroke();
    const tx = f.target.x, ty = f.target.y;
    ctx.strokeStyle = '#ffe14d';
    ctx.lineWidth = 3;
    const pr = f.target.r + 8 + Math.sin(tick * 0.25) * 2.5;
    for (let i = 0; i < 4; i++) {
      const a = tick * 0.05 + i * Math.PI / 2;
      groundArc(tx, ty, pr, a, a + 0.9); ctx.stroke();
    }
    const lab = toScreen(tx, ty, 44);
    ctx.fillStyle = '#ffe14d';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText('PASS', lab.x, lab.y);
    ctx.fillText('PASS', lab.x, lab.y);
  } else {
    // Free flick: arrow along the grass; length and colour show power
    const frac = (f.power - 4) / 14;
    const len = 30 + frac * 150;
    const col = 'hsl(' + Math.round(120 - 120 * frac) + ',90%,55%)';
    const s0 = toScreen(bx, by, 0);
    const s1 = toScreen(bx + f.aimX * len, by + f.aimY * len, 0);
    const sb = toScreen(bx + f.aimX * (len - 14), by + f.aimY * (len - 14), 0);
    const grad = ctx.createLinearGradient(s0.x, s0.y, s1.x, s1.y);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, col);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 5;
    ctx.setLineDash([8, 7]);
    ctx.lineDashOffset = -tick;
    ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.lineTo(s1.x, s1.y); ctx.stroke();
    ctx.setLineDash([]);
    const a = Math.atan2(s1.y - sb.y, s1.x - sb.x);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(s1.x + Math.cos(a) * 12, s1.y + Math.sin(a) * 12);
    ctx.lineTo(s1.x + Math.cos(a + 2.4) * 10, s1.y + Math.sin(a + 2.4) * 10);
    ctx.lineTo(s1.x + Math.cos(a - 2.4) * 10, s1.y + Math.sin(a - 2.4) * 10);
    ctx.closePath(); ctx.fill();
    // Power arc on the grass around the carrier
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 5;
    groundArc(ox, oy, o.r + 13, 0, TAU); ctx.stroke();
    ctx.strokeStyle = col;
    ctx.lineWidth = 4;
    groundArc(ox, oy, o.r + 13, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0.02, frac)); ctx.stroke();
  }
  ctx.restore();
}

function drawDribbleTarget(ox, oy) {
  ctx.save();
  const a = toScreen(ox, oy, 0), b = toScreen(drag.gx, drag.gy, 0);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 6]);
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(255,225,77,0.9)';
  ctx.lineWidth = 2.5;
  groundArc(drag.gx, drag.gy, 10 + Math.sin(tick * 0.3) * 2, 0, TAU); ctx.stroke();
  ctx.restore();
}

function drawScoreDigit(n, x, y, pop) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1 + pop * 0.8, 1 + pop * 0.8);
  ctx.fillStyle = pop > 0.1 ? '#ffe14d' : '#ffffff';
  ctx.fillText(String(n), 0, 0);
  ctx.restore();
}

function drawHUD() {
  const px = W / 2 - 115, pw = 230;
  ctx.fillStyle = 'rgba(6,18,10,0.72)';
  roundRect(px, 14, pw, 40, 12); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = KITS.you.shirt;
  circle(px + 18, 34, 7); ctx.fill();
  ctx.fillStyle = KITS.cpu.shirt;
  circle(px + pw - 18, 34, 7); ctx.fill();

  ctx.textBaseline = 'middle';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.textAlign = 'left'; ctx.fillText('YOU', px + 31, 35);
  ctx.textAlign = 'right'; ctx.fillText('CPU', px + pw - 31, 35);

  ctx.textAlign = 'center';
  ctx.font = 'bold 24px sans-serif';
  drawScoreDigit(score.you, W / 2 - 22, 35, scorePop.you);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('-', W / 2, 34);
  drawScoreDigit(score.cpu, W / 2 + 22, 35, scorePop.cpu);

  const frac = Math.max(0, timeLeft) / 90;
  const low = timeLeft <= 10 && timeLeft > 0;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  roundRect(px + 10, 58, pw - 20, 5, 2.5); ctx.fill();
  ctx.fillStyle = low ? (tick % 30 < 15 ? '#ff5a5a' : '#ffb4b4') : 'hsl(' + Math.round(20 + 100 * frac) + ',85%,55%)';
  roundRect(px + 10, 58, Math.max(5, (pw - 20) * frac), 5, 2.5); ctx.fill();
  const secs = Math.max(0, Math.ceil(timeLeft));
  ctx.font = 'bold 13px sans-serif';
  ctx.fillStyle = low ? '#ff8080' : 'rgba(255,255,255,0.9)';
  ctx.fillText(Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0'), W / 2, 75);
  ctx.textBaseline = 'alphabetic';
}

function drawHint() {
  if (hintTimer <= 0 || timeLeft <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, hintTimer / 30);
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(6,18,10,0.75)';
  roundRect(W / 2 - 145, H - 92, 290, 46, 12); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Your receiver runs on - drag to steer', W / 2, H - 78);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText('Swipe anywhere else to pass or shoot', W / 2, H - 60);
  ctx.restore();
}

function drawMessage() {
  if (messageTimer <= 0) return;
  const t = 90 - messageTimer;
  const s = easeOutBack(Math.min(1, t / 14));
  const size = messageStyle === 'gold' ? 66 : (messageStyle === 'red' ? 42 : 46);
  ctx.save();
  ctx.globalAlpha = Math.min(1, messageTimer / 15);
  ctx.translate(W / 2, H / 2 - 40);
  ctx.scale(s, s);
  if (messageStyle === 'gold') ctx.rotate(Math.sin(t * 0.15) * 0.04);
  ctx.font = '900 ' + size + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 9;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.strokeText(message, 0, 0);
  if (messageStyle === 'gold') {
    const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
    g.addColorStop(0, '#fff7c2'); g.addColorStop(0.5, '#ffd84d'); g.addColorStop(1, '#f59e0b');
    ctx.fillStyle = g;
  } else ctx.fillStyle = messageStyle === 'red' ? '#ff6b6b' : '#ffffff';
  ctx.fillText(message, 0, 0);
  ctx.restore();
}

function drawEndScreen() {
  if (endFade <= 0) return;
  ctx.fillStyle = 'rgba(0,0,0,' + (0.65 * endFade) + ')';
  ctx.fillRect(0, 0, W, H);
  const drop = (1 - easeOutBack(endFade)) * -80;
  const result = score.you > score.cpu ? 'You win!' : (score.you < score.cpu ? 'You lose' : 'Draw');
  ctx.save();
  ctx.globalAlpha = endFade;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.font = '900 46px sans-serif';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.strokeText(result, W / 2, H / 2 - 40 + drop);
  ctx.fillStyle = score.you > score.cpu ? '#ffe14d' : '#ffffff';
  ctx.fillText(result, W / 2, H / 2 - 40 + drop);
  ctx.font = 'bold 30px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(score.you + '  -  ' + score.cpu, W / 2, H / 2 + 10 + drop);
  ctx.font = '18px sans-serif';
  ctx.globalAlpha = endFade * (0.55 + 0.45 * Math.sin(tick * 0.08));
  ctx.fillText('Tap to play again', W / 2, H / 2 + 60);
  ctx.restore();
}

function draw(a, dt) {
  const bx = lerp(ball.px, ball.x, a), by = lerp(ball.py, ball.y, a), bz = lerp(ball.pz, ball.z, a);
  updateCamera(bx, by, dt);

  const pos2 = allPlayers.map(p => ({ x: lerp(p.px, p.x, a), y: lerp(p.py, p.y, a) }));
  allPlayers.forEach((p, i) => updatePlayerMesh(p, playerMeshes[i], pos2[i].x, pos2[i].y));

  // A carried ball is drawn at the carrier's right foot so their body doesn't hide it from the camera
  let vbx = bx, vby = by;
  if (ball.owner && celebrate === 0) {
    const oi0 = allPlayers.indexOf(ball.owner), f = ball.owner.face;
    vbx = pos2[oi0].x + Math.cos(f) * 9 - Math.sin(f) * 8;
    vby = pos2[oi0].y + Math.sin(f) * 9 + Math.cos(f) * 8;
  }
  // Ball rolls for real: rotate about the axis perpendicular to its travel
  const BX = wx(vbx), BZ = wz(vby);
  if (lastBallW) {
    const dx = BX - lastBallW.x, dz = BZ - lastBallW.z, d = Math.hypot(dx, dz);
    if (d > 1e-4 && d < 5) { rollAxis.set(dz / d, 0, -dx / d); ballMesh.rotateOnWorldAxis(rollAxis, d / BALL_VR); }
  }
  lastBallW = { x: BX, z: BZ };
  ballMesh.position.set(BX, BALL_VR + bz * 0.25, BZ);

  // Marker under whoever has the ball
  const owner = ball.owner;
  const oi = owner ? allPlayers.indexOf(owner) : -1;
  carrierRing.visible = oi >= 0 && celebrate === 0;
  if (carrierRing.visible) {
    carrierRing.position.x = wx(pos2[oi].x);
    carrierRing.position.z = wz(pos2[oi].y);
    carrierRing.rotation.y = tick * 0.03;
    if (owner.team === 'you') {
      let danger = 0;
      for (const c of cpuTeam) danger = Math.max(danger, 1 - Math.min(1, (Math.hypot(c.x - owner.x, c.y - owner.y) - 32) / 50));
      carrierMat.color.setRGB(1, lerp(0.88, 0.35, danger), lerp(0.3, 0.27, danger));
      carrierMat.opacity = 0.95;
    } else {
      carrierMat.color.set('#ff5a5a');
      carrierMat.opacity = 0.5 + 0.4 * Math.sin(tick * 0.3);
    }
  }
  updateRings();
  goals.forEach(updateNet);
  renderer.render(scene, camera);

  // 2D overlay
  ctx.setTransform(viewK, 0, 0, viewK, 0, 0);
  ctx.clearRect(0, 0, W, H);
  drawTrail();
  drawParticles();
  if (drag && oi >= 0 && owner.team === 'you' && celebrate === 0 && timeLeft > 0) {
    if (drag.mode === 'flick') drawAim(owner, pos2[oi].x, pos2[oi].y, bx, by);
    else drawDribbleTarget(pos2[oi].x, pos2[oi].y);
  }
  if (flashAlpha > 0.01) {
    ctx.globalAlpha = flashAlpha;
    ctx.fillStyle = flashColor;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
  drawHUD();
  drawHint();
  drawMessage();
  drawEndScreen();
}

// ---------- Loop ----------
let last = performance.now(), acc = 0;
function loop(now) {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  acc += dt * (slowMo > 0 ? 0.35 : 1);
  let n = 0;
  while (acc >= STEP && n < 8) { step(); acc -= STEP; n++; }
  if (n === 8) acc = 0;
  draw(Math.min(1, acc / STEP), dt);
  requestAnimationFrame(loop);
}
flash('KICK OFF', 'white');
updateCamera(ball.x, ball.y, 1);
requestAnimationFrame(loop);
