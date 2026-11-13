// 雷電将軍サイト
// しくみ: 4秒の動画を120枚の画像に分けておき、スクロール量に合わせて1枚ずつキャンバスに描く。

const FRAME_COUNT = 120;
const framePath = (i) => `img/frames/f_${String(i + 1).padStart(3, "0")}.jpg`;
const FOCUS_X = 0.49; // スマホで左右を切るとき、どこを中心に残すか（顔の位置）
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const hero = document.getElementById("hero");
const canvas = document.getElementById("heroCanvas");
const ctx = canvas.getContext("2d");
const flash = document.getElementById("flash");
const scenes = [...document.querySelectorAll(".scene")];
const dots = [...document.querySelectorAll(".progress li")];
const loader = document.getElementById("loader");
const loaderNum = document.getElementById("loaderNum");

document.body.classList.add("loading");

/* ---------- 1. コマ画像を先に読み込む ---------- */
const frames = new Array(FRAME_COUNT);
let loaded = 0;

function loadFrames() {
  return new Promise((resolve) => {
    for (let i = 0; i < FRAME_COUNT; i++) {
      const img = new Image();
      img.decoding = "async";
      img.onload = img.onerror = () => {
        loaded++;
        loaderNum.textContent = Math.round((loaded / FRAME_COUNT) * 100);
        if (loaded === FRAME_COUNT) resolve();
      };
      img.src = framePath(i);
      frames[i] = img;
    }
  });
}

/* ---------- 2. キャンバスに1コマ描く（画面いっぱいに切り抜く） ---------- */
function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  drawn = -1;
}

let drawn = -1;
function drawFrame(index) {
  const img = frames[index];
  if (!img || !img.complete || !img.naturalWidth || index === drawn) return;
  drawn = index;
  const cw = canvas.width, ch = canvas.height;
  const scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
  const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
  const x = Math.min(0, Math.max(cw - w, cw / 2 - w * FOCUS_X));
  const y = (ch - h) / 2;
  ctx.fillStyle = "#0f0d16";
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(img, x, y, w, h);
}

/* ---------- 3. スクロール量 → コマ番号・文字の出入り ---------- */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function heroProgress() {
  const rect = hero.getBoundingClientRect();
  const total = hero.offsetHeight - window.innerHeight;
  return clamp(-rect.top / total, 0, 1);
}

// 0→1→0 の山型。from〜to の区間で、最初の25%で現れ、最後の25%で消える
function bell(p, from, to) {
  if (p < from || p > to) return 0;
  const t = (p - from) / (to - from);
  if (t < 0.25) return t / 0.25;
  if (t > 0.75) return (1 - t) / 0.25;
  return 1;
}

let current = 0; // 実際に表示中のコマ（なめらかに追いかける）

function update() {
  const p = heroProgress();
  const target = p * (FRAME_COUNT - 1);
  current += (target - current) * (reduceMotion ? 1 : 0.18);
  if (Math.abs(target - current) < 0.01) current = target;
  drawFrame(Math.round(current));

  scenes.forEach((el, i) => {
    const from = parseFloat(el.dataset.from);
    const to = parseFloat(el.dataset.to);
    // 最初の場面だけは最初から表示しておく
    const o = i === 0 ? (p <= from ? 1 : bell(p, -0.1, to)) : bell(p, from, to);
    el.style.opacity = o.toFixed(3);
    el.style.setProperty("--y", `${((1 - o) * 30).toFixed(1)}px`);
  });

  dots.forEach((d) => d.classList.toggle("on", p >= parseFloat(d.dataset.at)));

  // 章が切り替わる瞬間に、紫の稲光を一瞬重ねる
  if (!reduceMotion) {
    const f = Math.max(...dots.map((d) => Math.exp(-Math.pow((p - parseFloat(d.dataset.at)) * 60, 2))));
    flash.style.opacity = (f * 0.9).toFixed(3);
  }

  requestAnimationFrame(update);
}

/* ---------- 4. 下のセクションをふわっと出す ---------- */
const io = new IntersectionObserver(
  (entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }),
  { threshold: 0.15 }
);
document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

/* ---------- 5. 舞い散る紫の花びら ---------- */
function startPetals() {
  const c = document.getElementById("petals");
  const g = c.getContext("2d");
  let W, H;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = c.width = innerWidth * dpr;
    H = c.height = innerHeight * dpr;
  };
  resize();
  addEventListener("resize", resize);

  const n = innerWidth < 600 ? 18 : 34;
  const petals = Array.from({ length: n }, () => newPetal(true));
  function newPetal(anywhere) {
    return {
      x: Math.random() * W,
      y: anywhere ? Math.random() * H : -20,
      s: (6 + Math.random() * 8) * (W / innerWidth),
      vx: 0.3 + Math.random() * 0.6,
      vy: 0.6 + Math.random() * 0.9,
      r: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.04,
      sway: Math.random() * Math.PI * 2,
      hue: 270 + Math.random() * 30,
    };
  }

  let lastY = scrollY;
  (function tick() {
    const dy = (scrollY - lastY) * 0.05; // スクロールすると少し流される
    lastY = scrollY;
    g.clearRect(0, 0, W, H);
    for (let i = 0; i < petals.length; i++) {
      const pt = petals[i];
      pt.sway += 0.02;
      pt.x += pt.vx + Math.sin(pt.sway) * 0.6;
      pt.y += pt.vy - dy;
      pt.r += pt.vr;
      if (pt.y > H + 30 || pt.x > W + 30 || pt.y < -60) petals[i] = newPetal(false);
      g.save();
      g.translate(pt.x, pt.y);
      g.rotate(pt.r);
      g.scale(1, Math.abs(Math.sin(pt.sway * 0.7)) * 0.6 + 0.4); // くるくる回って見える
      g.fillStyle = `hsla(${pt.hue}, 80%, 82%, 0.75)`;
      g.beginPath();
      g.moveTo(0, -pt.s);
      g.quadraticCurveTo(pt.s * 0.8, 0, 0, pt.s);
      g.quadraticCurveTo(-pt.s * 0.8, 0, 0, -pt.s);
      g.fill();
      g.restore();
    }
    requestAnimationFrame(tick);
  })();
}

/* ---------- 開始 ---------- */
addEventListener("resize", resizeCanvas);
resizeCanvas();

loadFrames().then(() => {
  resizeCanvas();
  drawFrame(Math.round(heroProgress() * (FRAME_COUNT - 1)));
  loader.classList.add("done");
  document.body.classList.remove("loading");
  requestAnimationFrame(update);
  if (!reduceMotion) startPetals();
});
