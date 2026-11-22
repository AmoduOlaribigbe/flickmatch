// Flick Match - original flick-to-pass soccer prototype
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const W = 400, H = 700;
canvas.width = W;
canvas.height = H;

function fit() {
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  canvas.style.width = (W * s) + 'px';
  canvas.style.height = (H * s) + 'px';
}
window.addEventListener('resize', fit);
fit();

// ---------- State ----------
const GOAL_W = 140, GOAL_X = (W - GOAL_W) / 2;
let score = { you: 0, cpu: 0 };
let timeLeft = 90;
let message = '';
let messageTimer = 0;

const ball = { x: W / 2, y: 520, vx: 0, vy: 0, r: 9, owner: null };

const myTeam = [
  { x: 200, y: 560, r: 16 },
  { x: 90,  y: 470, r: 16 },
  { x: 310, y: 470, r: 16 },
  { x: 200, y: 380, r: 16 }
];

const cpuTeam = [
  { x: 200, y: 140, r: 16, homeX: 200 },
  { x: 110, y: 230, r: 16, homeX: 110 },
  { x: 290, y: 230, r: 16, homeX: 290 },
  { x: 200, y: 310, r: 16, homeX: 200 }
];

function giveBall(p) {
  ball.owner = p;
  ball.vx = 0;
  ball.vy = 0;
  ball.x = p.x;
  ball.y = p.y;
}
giveBall(myTeam[0]);

function reset(scoredByYou) {
  myTeam[0].x = 200; myTeam[0].y = 560;
  myTeam[1].x = 90;  myTeam[1].y = 470;
  myTeam[2].x = 310; myTeam[2].y = 470;
  myTeam[3].x = 200; myTeam[3].y = 380;
  cpuTeam[0].x = 200; cpuTeam[1].x = 110; cpuTeam[2].x = 290; cpuTeam[3].x = 200;
  giveBall(scoredByYou ? myTeam[0] : myTeam[0]);
}

function flash(text) {
  message = text;
  messageTimer = 90;
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
  const p = pos(e);
  drag = { sx: p.x, sy: p.y, cx: p.x, cy: p.y, t: performance.now() };
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
  drag = null;
  if (dist < 20 || !ball.owner || ball.owner.team === 'cpu') return;

  // Pass assist: if a teammate sits roughly in the swipe direction, aim at them
  let aimX = dx / dist, aimY = dy / dist;
  let best = null, bestScore = 0;
  for (const mate of myTeam) {
    if (mate === ball.owner) continue;
    const mx = mate.x - ball.owner.x, my = mate.y - ball.owner.y;
    const md = Math.hypot(mx, my);
    if (md < 30) continue;
    // 1 means exactly in the swipe direction, 0 means sideways
    const align = (mx / md) * aimX + (my / md) * aimY;
    if (align > 0.9 && align > bestScore) { best = mate; bestScore = align; }
  }

  let power = Math.min(dist / 12, 14) + 4;
  if (best) {
    const mx = best.x - ball.owner.x, my = best.y - ball.owner.y;
    const md = Math.hypot(mx, my);
    aimX = mx / md;
    aimY = my / md;
    // Just enough power to roll to the teammate and stop near them
    power = Math.max(4, Math.min(md / 28, 14));
  }

  ball.vx = aimX * power;
  ball.vy = aimY * power;
  ball.lastKicker = ball.owner;
  ball.owner = null;
  ball.cooldown = 12;
}

canvas.addEventListener('mousedown', down);
canvas.addEventListener('mousemove', move);
window.addEventListener('mouseup', up);
canvas.addEventListener('touchstart', down, { passive: false });
canvas.addEventListener('touchmove', move, { passive: false });
canvas.addEventListener('touchend', up, { passive: false });

// ---------- Update ----------
function update() {
  if (timeLeft <= 0) return;

  // Ball follows its owner
  if (ball.owner) {
    ball.x = ball.owner.x;
    ball.y = ball.owner.y - 4;
  } else {
    ball.x += ball.vx;
    ball.y += ball.vy;
    ball.vx *= 0.985;
    ball.vy *= 0.985;
    if (ball.cooldown > 0) ball.cooldown--;

    // Side walls bounce
    if (ball.x < ball.r) { ball.x = ball.r; ball.vx *= -0.8; }
    if (ball.x > W - ball.r) { ball.x = W - ball.r; ball.vx *= -0.8; }

    // Goals: top is the computer's, bottom is yours
    const inGoal = ball.x > GOAL_X && ball.x < GOAL_X + GOAL_W;
    if (ball.y < ball.r) {
      if (inGoal) { score.you++; flash('GOAL!'); reset(true); }
      else { ball.y = ball.r; ball.vy *= -0.8; }
    }
    if (ball.y > H - ball.r) {
      if (inGoal) { score.cpu++; flash('Conceded'); reset(false); }
      else { ball.y = H - ball.r; ball.vy *= -0.8; }
    }

    // Catching: any player touching a slow-enough ball takes it
    if (!(ball.cooldown > 0)) {
      const speed = Math.hypot(ball.vx, ball.vy);
      const all = myTeam.map(p => ({ p, team: 'you' })).concat(cpuTeam.map(p => ({ p, team: 'cpu' })));
      for (const o of all) {
        const d = Math.hypot(o.p.x - ball.x, o.p.y - ball.y);
        if (d < o.p.r + ball.r) {
          // Faster balls are harder for the computer to catch, giving you room to score
          if (o.team === 'cpu' && speed > 9 && Math.random() < 0.6) continue;
          o.p.team = o.team;
          giveBall(o.p);
          break;
        }
      }
    }
  }

  // Mark team on players
  myTeam.forEach(p => p.team = 'you');
  cpuTeam.forEach(p => p.team = 'cpu');

  // Simple computer AI
  cpuTeam.forEach(function (p, i) {
    if (ball.owner && ball.owner.team === 'cpu' && ball.owner === p) {
      // Dribble toward your goal, then shoot
      p.y += 1.3;
      p.x += (W / 2 - p.x) * 0.01;
      if (p.y > 470) {
        const tx = GOAL_X + Math.random() * GOAL_W;
        const dx = tx - p.x, dy = H - p.y;
        const d = Math.hypot(dx, dy);
        ball.vx = (dx / d) * 9;
        ball.vy = (dy / d) * 9;
        ball.owner = null;
        ball.cooldown = 15;
      }
    } else {
      // Chase the loose ball a little, otherwise hold position
      const targetX = !ball.owner ? ball.x : p.homeX;
      p.x += Math.max(-1.4, Math.min(1.4, targetX - p.x));
      if (!ball.owner) p.y += Math.max(-1, Math.min(1, (ball.y - p.y) * 0.02));
    }
    p.x = Math.max(p.r, Math.min(W - p.r, p.x));
  });

  // Computer steals if it touches your carrier closely
  if (ball.owner && ball.owner.team === 'you') {
    for (const c of cpuTeam) {
      if (Math.hypot(c.x - ball.owner.x, c.y - ball.owner.y) < c.r + ball.owner.r - 2) {
        giveBall(c);
        flash('Lost it!');
        break;
      }
    }
  }

  if (messageTimer > 0) messageTimer--;
}

// ---------- Draw ----------
function draw() {
  // Pitch
  ctx.fillStyle = '#1b6b2f';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#217a37';
  for (let i = 0; i < 10; i += 2) ctx.fillRect(0, i * 70, W, 70);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 10, W - 20, H - 20);
  ctx.beginPath(); ctx.moveTo(10, H / 2); ctx.lineTo(W - 10, H / 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(W / 2, H / 2, 50, 0, Math.PI * 2); ctx.stroke();

  // Goals
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(GOAL_X, 0, GOAL_W, 8);
  ctx.fillRect(GOAL_X, H - 8, GOAL_W, 8);

  // Players
  function player(p, color) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  }
  cpuTeam.forEach(p => player(p, '#d33'));
  myTeam.forEach(p => player(p, '#2563eb'));

  // Highlight the player holding the ball
  if (ball.owner && ball.owner.team === 'you') {
    ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(ball.owner.x, ball.owner.y, ball.owner.r + 5, 0, Math.PI * 2); ctx.stroke();
  }

  // Ball
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();

  // Swipe aiming line
  if (drag && ball.owner && ball.owner.team === 'you') {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ball.x, ball.y);
    ctx.lineTo(ball.x + (drag.cx - drag.sx), ball.y + (drag.cy - drag.sy));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // HUD
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('You ' + score.you + ' - ' + score.cpu + ' CPU', 20, 40);
  ctx.textAlign = 'right';
  ctx.fillText(Math.max(0, Math.ceil(timeLeft)) + 's', W - 20, 40);

  if (messageTimer > 0) {
    ctx.textAlign = 'center';
    ctx.font = 'bold 44px sans-serif';
    ctx.fillText(message, W / 2, H / 2);
  }

  if (timeLeft <= 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 40px sans-serif';
    const result = score.you > score.cpu ? 'You win!' : (score.you < score.cpu ? 'You lose' : 'Draw');
    ctx.fillText(result, W / 2, H / 2 - 10);
    ctx.font = '20px sans-serif';
    ctx.fillText('Tap to play again', W / 2, H / 2 + 30);
  }
}

// ---------- Restart ----------
canvas.addEventListener('click', function () {
  if (timeLeft <= 0) {
    score = { you: 0, cpu: 0 };
    timeLeft = 90;
    reset(true);
  }
});

// ---------- Loop ----------
let last = performance.now();
function loop(now) {
  const dt = (now - last) / 1000;
  last = now;
  if (timeLeft > 0) timeLeft -= dt;
  update();
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
