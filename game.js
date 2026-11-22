// Flick Match - original flick-to-pass soccer prototype (animated 2D edition)
'use strict';
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const W = 400, H = 700, TAU = Math.PI * 2;
const STEP = 1 / 60; // fixed simulation step, same speed on 60Hz and 120Hz screens

// ---------- Helpers ----------
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const mod = (a, m) => ((a % m) + m) % m;
function lerpAngle(a, b, t) { return a + (mod(b - a + Math.PI, TAU) - Math.PI) * t; }
function easeOutBack(t) { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
function seeded(seed) { return function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); }
function ellipse(x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); }
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

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
  you: { shirt: '#2563eb', dark: '#1e3a8a', trim: '#bfdbfe', sock: '#f8fafc' },
  cpu: { shirt: '#dc2626', dark: '#7f1d1d', trim: '#fee2e2', sock: '#111827' }
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
const myTeam = HOME_YOU.map((h, i) => makePlayer(h[0], h[1], i, 'you'));
const cpuTeam = [
  makePlayer(200, 140, 2, 'cpu', { homeX: 200, homeY: 140 }),
  makePlayer(110, 230, 3, 'cpu', { homeX: 110, homeY: 230 }),
  makePlayer(290, 230, 0, 'cpu', { homeX: 290, homeY: 230 }),
  makePlayer(200, 310, 1, 'cpu', { homeX: 200, homeY: 310 })
];
const allPlayers = myTeam.concat(cpuTeam);

const DRIBBLE_SPEED = 2.1;   // your carrier when you drag them
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

// ---------- Particles ----------
function spawn(o) {
  if (particles.length > 450) particles.shift();
  const q = Object.assign({ x: 0, y: 0, vx: 0, vy: 0, life: 30, size: 3, color: '#fff', g: 0, drag: 0.92, type: 'dot', rot: 0, vr: 0 }, o);
  q.max = q.life;
  particles.push(q);
}
function puff(x, y, n, vx, vy) {
  for (let i = 0; i < n; i++) {
    spawn({
      x: x + rand(-3, 3), y: y + rand(-2, 4),
      vx: rand(-1.2, 1.2) - (vx || 0) * 0.08, vy: rand(-1.2, 1.2) - (vy || 0) * 0.08,
      life: rand(18, 32), size: rand(1.8, 4), drag: 0.9,
      color: Math.random() < 0.6 ? '#d9ecb8' : '#8a6a3c'
    });
  }
}
function ring(x, y, size, color) { spawn({ type: 'ring', x, y, size, color, life: 18 }); }
function confetti(x0, x1, y, dir, n, colors) {
  for (let i = 0; i < n; i++) {
    spawn({
      type: 'confetti', x: rand(x0, x1), y,
      vx: rand(-3.5, 3.5), vy: dir * rand(1.5, 7.5),
      g: 0.06, drag: 0.975, life: rand(80, 150), size: rand(3, 5),
      rot: rand(0, TAU), vr: rand(-0.3, 0.3),
      color: colors[(Math.random() * colors.length) | 0]
    });
  }
}
function sparks(x, y) {
  for (let i = 0; i < 16; i++) {
    const a = rand(0, TAU), s = rand(2, 5.5);
    spawn({ type: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(14, 22), drag: 0.88, color: Math.random() < 0.5 ? '#ffd166' : '#ff5a5a' });
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
  if (yours) confetti(GOAL_X, GOAL_X + GOAL_W, NET_D + 2, 1, 150, ['#ffe14d', '#2563eb', '#ffffff', '#60a5fa', '#facc15']);
  else confetti(GOAL_X, GOAL_X + GOAL_W, H - NET_D - 2, -1, 50, ['#dc2626', '#fecaca', '#ffffff']);
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
  if (best) {
    const mx = best.x - owner.x, my = best.y - owner.y;
    const md = Math.hypot(mx, my);
    aimX = mx / md;
    aimY = my / md;
    // Just enough power to roll to the teammate and stop near them
    power = Math.max(4, Math.min(md / 28, 14));
  }
  return { aimX, aimY, power, target: best };
}

// ---------- Input: swipe to flick ----------
let drag = null;

function pos(e) {
  const rect = canvas.getBoundingClientRect();
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
  const p = pos(e);
  // Touching your ball carrier starts a dribble; touching anywhere else starts a flick
  const o = ball.owner;
  const mode = (o && o.team === 'you' && Math.hypot(p.x - o.x, p.y - o.y) < 48) ? 'dribble' : 'flick';
  drag = { mode, sx: p.x, sy: p.y, cx: p.x, cy: p.y, t: performance.now() };
}
function move(e) {
  if (!drag) return;
  e.preventDefault();
  const p = pos(e);
  drag.cx = p.x;
  drag.cy = p.y;
}
function up(e) {
  if (!drag) return;
  e.preventDefault();
  const dx = drag.cx - drag.sx;
  const dy = drag.cy - drag.sy;
  const dist = Math.hypot(dx, dy);
  const mode = drag.mode;
  drag = null;
  if (mode === 'dribble') return; // letting go just stops the run
  if (dist < 20 || !ball.owner || ball.owner.team === 'cpu' || celebrate > 0 || timeLeft <= 0) return;
  const f = computeFlick(ball.owner, dx, dy);
  kick(ball.owner, f.aimX * f.power, f.aimY * f.power, f.power);
  ball.cooldown = 12;
  ball.passTarget = f.target;
}

canvas.addEventListener('mousedown', down);
canvas.addEventListener('mousemove', move);
window.addEventListener('mouseup', up);
canvas.addEventListener('touchstart', down, { passive: false });
canvas.addEventListener('touchmove', move, { passive: false });
canvas.addEventListener('touchend', up, { passive: false });

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

  // You control the carrier by dragging them
  if (o && o.team === 'you' && drag && drag.mode === 'dribble') {
    moveToward(o, drag.cx, drag.cy, DRIBBLE_SPEED);
    hintTimer = Math.min(hintTimer, 60);
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
        // Receiver waits for the pass, then steps in to meet it
        if (Math.hypot(ball.x - p.x, ball.y - p.y) < 90) moveToward(p, ball.x, ball.y, 1.8);
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
    ball.spin += Math.hypot(o.vx, o.vy) / ball.r;
    ball.z = 0; ball.vz = 0;
  } else {
    ball.x += ball.vx;
    ball.y += ball.vy;
    ball.vx *= 0.985;
    ball.vy *= 0.985;
    if (ball.cooldown > 0) ball.cooldown--;
    const speed = Math.hypot(ball.vx, ball.vy);
    ball.spin += speed / ball.r;
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
  // Ball rolls on into the net and settles
  ball.x += ball.vx; ball.y += ball.vy;
  ball.vx *= 0.88; ball.vy *= 0.88;
  ball.spin += Math.hypot(ball.vx, ball.vy) / ball.r;
  ball.y = Math.max(3, Math.min(H - 3, ball.y));
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
        const dx = drag.cx - drag.sx, dy = drag.cy - drag.sy;
        if (Math.hypot(dx, dy) > 10) { const f = computeFlick(p, dx, dy); target = Math.atan2(f.aimY, f.aimX); }
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
    q.x += q.vx; q.y += q.vy;
    q.vx *= q.drag; q.vy = q.vy * q.drag + q.g;
    q.rot += q.vr;
    if (--q.life <= 0) particles.splice(i, 1);
  }
  const speed = Math.hypot(ball.vx, ball.vy);
  if (!ball.owner && speed > 4.5) ball.trail.push({ x: ball.x, y: ball.y - ball.z });
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
    if (score.you > score.cpu && tick % 5 === 0) confetti(0, W, -5, 1, 3, ['#ffe14d', '#2563eb', '#ffffff', '#60a5fa']);
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

// ---------- Display (crisp on high-DPI phones) ----------
let viewK = 1;
const pitchLayer = document.createElement('canvas');

function fit() {
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.style.width = (W * s) + 'px';
  canvas.style.height = (H * s) + 'px';
  viewK = s * dpr;
  canvas.width = pitchLayer.width = Math.max(1, Math.round(W * viewK));
  canvas.height = pitchLayer.height = Math.max(1, Math.round(H * viewK));
  renderPitch();
}

// The pitch never changes, so draw it once into an offscreen canvas
function renderPitch() {
  const g = pitchLayer.getContext('2d');
  g.setTransform(viewK, 0, 0, viewK, 0, 0);
  for (let i = 0; i < 10; i++) { g.fillStyle = i % 2 ? '#1f7a37' : '#258c40'; g.fillRect(0, i * 70, W, 70); }
  const r = seeded(7);
  for (let i = 0; i < 3500; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
    g.fillRect(r() * W, r() * H, 1, r() * 2.5 + 0.8);
  }
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 2;
  g.strokeRect(10, 10, W - 20, H - 20);
  g.beginPath(); g.moveTo(10, H / 2); g.lineTo(W - 10, H / 2); g.stroke();
  g.beginPath(); g.arc(W / 2, H / 2, 50, 0, TAU); g.stroke();
  g.beginPath(); g.arc(W / 2, H / 2, 3, 0, TAU); g.fill();
  const da = Math.acos(25 / 45);
  [true, false].forEach(function (top) {
    g.strokeRect(80, top ? 10 : H - 110, 240, 100);
    g.strokeRect(140, top ? 10 : H - 45, 120, 35);
    const spotY = top ? 85 : H - 85;
    g.beginPath(); g.arc(W / 2, spotY, 2.5, 0, TAU); g.fill();
    g.beginPath();
    if (top) g.arc(W / 2, spotY, 45, Math.PI / 2 - da, Math.PI / 2 + da);
    else g.arc(W / 2, spotY, 45, -Math.PI / 2 - da, -Math.PI / 2 + da);
    g.stroke();
  });
  [[10, 10, 0], [W - 10, 10, Math.PI / 2], [W - 10, H - 10, Math.PI], [10, H - 10, Math.PI * 1.5]].forEach(function (c) {
    g.beginPath(); g.arc(c[0], c[1], 10, c[2], c[2] + Math.PI / 2); g.stroke();
  });
  const light = g.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, H * 0.72);
  light.addColorStop(0, 'rgba(255,255,230,0.07)');
  light.addColorStop(1, 'rgba(0,0,0,0.4)');
  g.fillStyle = light;
  g.fillRect(0, 0, W, H);
}

window.addEventListener('resize', fit);
fit();

// ---------- Draw ----------
function drawGoal(top) {
  const y0 = top ? 0 : H - NET_D;
  const amp = top ? net.top : net.bottom;
  const bulge = x => amp * Math.exp(-((x - net.hitX) * (x - net.hitX)) / 1800);
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(GOAL_X, y0, GOAL_W, NET_D);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  for (let x = GOAL_X; x <= GOAL_X + GOAL_W + 0.1; x += 7) {
    const wob = 5 * bulge(x) * Math.sin(tick * 0.6 + x * 0.15);
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x + wob, y0 + NET_D); ctx.stroke();
  }
  for (let y = y0 + 3.5; y < y0 + NET_D; y += 3.5) {
    ctx.beginPath();
    for (let x = GOAL_X; x <= GOAL_X + GOAL_W + 0.1; x += 7) {
      const yy = y + 2.5 * bulge(x) * Math.sin(tick * 0.5 + x * 0.2);
      if (x === GOAL_X) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  const barY = top ? NET_D : H - NET_D;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(GOAL_X + 2, barY + 3); ctx.lineTo(GOAL_X + GOAL_W + 2, barY + 3); ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(GOAL_X, barY); ctx.lineTo(GOAL_X + GOAL_W, barY); ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(GOAL_X, y0); ctx.lineTo(GOAL_X, y0 + NET_D);
  ctx.moveTo(GOAL_X + GOAL_W, y0); ctx.lineTo(GOAL_X + GOAL_W, y0 + NET_D);
  ctx.stroke();
  ctx.restore();
}

function drawPlayer(p, x, y) {
  const kit = KITS[p.team];
  const sp = Math.min(1, Math.hypot(p.vx, p.vy) / 1.3);
  const swing = Math.sin(p.run) * sp;
  const hop = (celebrate > 40 && p.team === lastScorer) ? Math.abs(Math.sin(tick * 0.22 + p.seed)) * 7 : 0;
  const breathe = 1 + Math.sin(tick * 0.07 + p.seed) * 0.025;

  // Shadow shrinks as the player hops
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ellipse(x + 3 + hop * 0.4, y + 5 + hop * 0.3, 15 - hop * 0.6, 11 - hop * 0.5);
  ctx.fill();

  // Catch glow
  if (p.catchFx > 0.05) {
    ctx.strokeStyle = p.team === 'you' ? 'rgba(255,225,77,' + p.catchFx + ')' : 'rgba(255,123,123,' + p.catchFx + ')';
    ctx.lineWidth = 3;
    circle(x, y, p.r + 4 + (1 - p.catchFx) * 10);
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(x, y - hop);
  const sc = breathe * (1 + hop * 0.02);
  ctx.scale(sc, sc);
  ctx.rotate(p.face + Math.PI / 2); // local -y now points where the player faces

  // Legs: one forward, one back while running; right leg snaps forward on a kick
  for (const side of [-1, 1]) {
    let ly = side * swing * 8;
    if (side === 1 && p.kick > 0.05) ly = lerp(ly, -15, p.kick);
    ctx.strokeStyle = kit.sock;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(side * 5, 0); ctx.lineTo(side * 5, ly); ctx.stroke();
    ctx.fillStyle = '#1f2937';
    circle(side * 5, ly - (ly < 0 ? 2 : -2), 3.4);
    ctx.fill();
  }

  // Arms swing opposite to the legs
  for (const side of [-1, 1]) {
    const ay = -side * swing * 6 + (hop ? -6 : 0);
    ctx.fillStyle = kit.shirt;
    circle(side * 10.5, ay * 0.5, 4.2); ctx.fill();
    ctx.fillStyle = p.skin;
    circle(side * 12.5, ay, 3.2); ctx.fill();
  }

  // Torso with a shoulder stripe
  ctx.fillStyle = kit.shirt;
  ellipse(0, 1, 12.5, 8.5); ctx.fill();
  ctx.strokeStyle = kit.dark;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.strokeStyle = kit.trim;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, 1, 9.5, 5.5, 0, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();

  // Head with hair on the back half
  ctx.fillStyle = p.skin;
  circle(0, -1, 6.3); ctx.fill();
  ctx.fillStyle = p.hair;
  ctx.beginPath(); ctx.arc(0, -1, 6.3, -0.25, Math.PI + 0.25); ctx.fill();
  ctx.restore();
}

function drawPentagon(cx, cy, rad, sx) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(sx, 1);
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + i * TAU / 5;
    if (i) ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad); else ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBall(bx, by, bz) {
  // Motion trail
  const n = ball.trail.length;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < n; i++) {
    const t = ball.trail[i], k = (i + 1) / n;
    ctx.globalAlpha = k * 0.3;
    circle(t.x, t.y, ball.r * k * 0.85); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Shadow stays on the grass and fades as the ball rises
  const sh = 1 / (1 + bz * 0.05);
  ctx.fillStyle = 'rgba(0,0,0,' + (0.35 * sh) + ')';
  ellipse(bx + 2 + bz * 0.5, by + 3 + bz * 0.35, ball.r * 1.05 * sh, ball.r * 0.75 * sh);
  ctx.fill();

  const r = ball.r * (1 + bz * 0.015);
  const y = by - bz;
  const shade = ctx.createRadialGradient(bx - r * 0.4, y - r * 0.4, r * 0.1, bx, y, r);
  shade.addColorStop(0, '#ffffff');
  shade.addColorStop(1, '#c4ccd4');
  ctx.save();
  ctx.fillStyle = shade;
  circle(bx, y, r); ctx.fill();
  ctx.clip();
  // Rolling patches: they slide along the travel direction and squash near the edge
  ctx.translate(bx, y);
  ctx.rotate(ball.dir);
  ctx.fillStyle = '#1d232a';
  const rows = [-0.62, 0, 0.62];
  for (let j = 0; j < 3; j++) {
    const v = rows[j] * r;
    const across = Math.sqrt(Math.max(0.2, 1 - rows[j] * rows[j]));
    for (let k = 0; k < 2; k++) {
      const u = mod(ball.spin * r + k * 1.2 * r + (j % 2) * 0.6 * r, 2.4 * r) - 1.2 * r;
      const sx = Math.sqrt(Math.max(0.15, 1 - (u / r) * (u / r)));
      drawPentagon(u, v, r * 0.3 * across, sx);
    }
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  circle(bx - r * 0.35, y - r * 0.38, r * 0.28); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1.2;
  circle(bx, y, r); ctx.stroke();
}

function drawCarrierRing(o, x, y) {
  if (o.team === 'you') {
    let danger = 0;
    for (const c of cpuTeam) danger = Math.max(danger, 1 - Math.min(1, (Math.hypot(c.x - o.x, c.y - o.y) - 32) / 50));
    const rr = Math.round(lerp(255, 255, danger)), gg = Math.round(lerp(225, 90, danger)), bb = Math.round(lerp(77, 70, danger));
    ctx.strokeStyle = 'rgb(' + rr + ',' + gg + ',' + bb + ')';
    ctx.lineWidth = 3;
    ctx.setLineDash([7, 5]);
    ctx.lineDashOffset = -tick * 0.6;
    circle(x, y, o.r + 6 + Math.sin(tick * 0.15) * 1.5 + danger * Math.sin(tick * 0.6) * 1.5);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    ctx.strokeStyle = 'rgba(255,90,90,' + (0.5 + 0.4 * Math.sin(tick * 0.3)) + ')';
    ctx.lineWidth = 3;
    circle(x, y, o.r + 6);
    ctx.stroke();
  }
}

function drawAim(o, ox, oy, bx, by) {
  const dx = drag.cx - drag.sx, dy = drag.cy - drag.sy;
  const dist = Math.hypot(dx, dy);
  if (dist < 8) return;
  const f = computeFlick(o, dx, dy);
  ctx.save();
  ctx.globalAlpha = dist >= 20 ? 1 : 0.4;
  if (f.target) {
    // Snapped pass: dotted path to the teammate plus a target ring
    const tx = f.target.x, ty = f.target.y;
    const d = Math.hypot(tx - bx, ty - by);
    const offset = (tick * 0.8) % 12;
    for (let s = 14 + offset; s < d - 20; s += 12) {
      const k = s / d;
      ctx.fillStyle = 'rgba(255,255,255,' + (0.95 - 0.5 * k) + ')';
      circle(bx + (tx - bx) * k, by + (ty - by) * k, 2.6); ctx.fill();
    }
    ctx.strokeStyle = '#ffe14d';
    ctx.lineWidth = 3;
    const pr = f.target.r + 8 + Math.sin(tick * 0.25) * 2.5;
    for (let i = 0; i < 4; i++) {
      const a = tick * 0.05 + i * Math.PI / 2;
      ctx.beginPath(); ctx.arc(tx, ty, pr, a, a + 0.9); ctx.stroke();
    }
    ctx.fillStyle = '#ffe14d';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PASS', tx, ty - pr - 6);
  } else {
    // Free flick: arrow length and colour show power
    const frac = (f.power - 4) / 14;
    const len = 30 + frac * 150;
    const ex = bx + f.aimX * len, ey = by + f.aimY * len;
    const col = 'hsl(' + Math.round(120 - 120 * frac) + ',90%,55%)';
    const grad = ctx.createLinearGradient(bx, by, ex, ey);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, col);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.setLineDash([8, 7]);
    ctx.lineDashOffset = -tick;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.setLineDash([]);
    const a = Math.atan2(f.aimY, f.aimX);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(ex + Math.cos(a) * 12, ey + Math.sin(a) * 12);
    ctx.lineTo(ex + Math.cos(a + 2.4) * 10, ey + Math.sin(a + 2.4) * 10);
    ctx.lineTo(ex + Math.cos(a - 2.4) * 10, ey + Math.sin(a - 2.4) * 10);
    ctx.closePath(); ctx.fill();
    // Power arc around the carrier
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 5;
    circle(ox, oy, o.r + 13); ctx.stroke();
    ctx.strokeStyle = col;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(ox, oy, o.r + 13, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0.02, frac)); ctx.stroke();
  }
  ctx.restore();
}

function drawParticles(topLayer) {
  for (const q of particles) {
    const isTop = q.type === 'confetti' || q.type === 'spark';
    if (isTop !== topLayer) continue;
    const k = q.life / q.max;
    ctx.globalAlpha = Math.min(1, k * 1.6);
    if (q.type === 'ring') {
      ctx.strokeStyle = q.color;
      ctx.lineWidth = 3 * k;
      circle(q.x, q.y, 4 + q.size * (1 - k)); ctx.stroke();
    } else if (q.type === 'confetti') {
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.rotate(q.rot);
      ctx.scale(1, Math.cos(q.rot * 1.7));
      ctx.fillStyle = q.color;
      ctx.fillRect(-q.size / 2, -q.size * 0.3, q.size, q.size * 0.6);
      ctx.restore();
    } else if (q.type === 'spark') {
      ctx.strokeStyle = q.color;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx * 2.5, q.y - q.vy * 2.5); ctx.stroke();
    } else {
      ctx.fillStyle = q.color;
      circle(q.x, q.y, q.size * (0.4 + 0.6 * k)); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
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

  // Timer bar under the panel
  const frac = Math.max(0, timeLeft) / 90;
  const low = timeLeft <= 10 && timeLeft > 0;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  roundRect(px + 10, 58, pw - 20, 5, 2.5); ctx.fill();
  ctx.fillStyle = low ? (tick % 30 < 15 ? '#ff5a5a' : '#ffb4b4') : 'hsl(' + Math.round(20 + 100 * frac) + ',85%,55%)';
  roundRect(px + 10, 58, Math.max(5, (pw - 20) * frac), 5, 2.5); ctx.fill();
  const secs = Math.max(0, Math.ceil(timeLeft));
  ctx.font = 'bold 13px sans-serif';
  ctx.fillStyle = low ? '#ff8080' : 'rgba(255,255,255,0.85)';
  ctx.fillText(Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0'), W / 2, 75);
  ctx.textBaseline = 'alphabetic';
}

function drawMessage() {
  if (messageTimer <= 0) return;
  const t = 90 - messageTimer;
  const s = easeOutBack(Math.min(1, t / 14));
  const size = messageStyle === 'gold' ? 66 : (messageStyle === 'red' ? 42 : 46);
  ctx.save();
  ctx.globalAlpha = Math.min(1, messageTimer / 15);
  ctx.translate(W / 2, H / 2);
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

function draw(a) {
  ctx.setTransform(viewK, 0, 0, viewK, 0, 0);
  ctx.fillStyle = '#0d3d1a';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  if (shake > 0.3) ctx.translate(rand(-shake, shake) * 0.5, rand(-shake, shake) * 0.5);
  ctx.drawImage(pitchLayer, 0, 0, W, H);
  drawParticles(false);

  // Interpolate between simulation steps for smooth motion on any refresh rate
  const list = allPlayers.map(p => ({ p, x: lerp(p.px, p.x, a), y: lerp(p.py, p.y, a) }));
  const owner = ball.owner;
  const ownerPos = owner ? list.find(e => e.p === owner) : null;
  if (ownerPos && celebrate === 0) drawCarrierRing(owner, ownerPos.x, ownerPos.y);
  list.sort((m, n) => m.y - n.y).forEach(e => drawPlayer(e.p, e.x, e.y));

  const bx = lerp(ball.px, ball.x, a), by = lerp(ball.py, ball.y, a), bz = lerp(ball.pz, ball.z, a);
  drawBall(bx, by, bz);
  drawGoal(true);
  drawGoal(false);

  if (drag && ownerPos && owner.team === 'you' && celebrate === 0 && timeLeft > 0) {
    if (drag.mode === 'flick') drawAim(owner, ownerPos.x, ownerPos.y, bx, by);
    else drawDribbleTarget(ownerPos.x, ownerPos.y);
  }
  drawParticles(true);
  ctx.restore();

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

function drawDribbleTarget(ox, oy) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 6]);
  ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(drag.cx, drag.cy); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(255,225,77,0.85)';
  ctx.lineWidth = 2.5;
  circle(drag.cx, drag.cy, 10 + Math.sin(tick * 0.3) * 2); ctx.stroke();
  ctx.restore();
}

function drawHint() {
  if (hintTimer <= 0 || timeLeft <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, hintTimer / 30);
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = ['Hold your player & drag to run', 'Swipe anywhere else to pass or shoot'];
  ctx.fillStyle = 'rgba(6,18,10,0.75)';
  roundRect(W / 2 - 135, H - 92, 270, 46, 12); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(lines[0], W / 2, H - 78);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText(lines[1], W / 2, H - 60);
  ctx.restore();
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
  draw(Math.min(1, acc / STEP));
  requestAnimationFrame(loop);
}
flash('KICK OFF', 'white');
requestAnimationFrame(loop);
