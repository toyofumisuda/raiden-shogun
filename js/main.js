// 雷電将軍サイト
// しくみ: AIで4倍に拡大した1枚絵を WebGL で描き、
//   ・袖・おさげ・赤い紐・裾を、場所ごとに風で揺らす（シェーダーで画素をずらす）
//   ・手元に雷の筋と光を重ねる
//   ・スクロール量に合わせてカメラが顔へ寄り、章の切り替えで稲光が走る

const IMG_W = 1480, IMG_H = 832; // 座標を決めるときの基準サイズ（元画像の2倍）
const FOCUS = [0.49, 0.30];       // 寄っていく先（顔のあたり）
const FOCUS_X_NARROW = 0.49;      // スマホで左右を切るときに残す中心
const ZOOM_MAX = 0.38;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const hero = document.getElementById("hero");
const canvas = document.getElementById("heroCanvas");
const flash = document.getElementById("flash");
const scenes = [...document.querySelectorAll(".scene")];
const dots = [...document.querySelectorAll(".progress li")];
const loader = document.getElementById("loader");
const loaderNum = document.getElementById("loaderNum");

document.body.classList.add("loading");

/* ---------- 1. 画像を読み込む（進み具合を%で表示） ---------- */
async function loadImage(url) {
  try {
    const res = await fetch(url);
    const total = Number(res.headers.get("content-length")) || 0;
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (total) loaderNum.textContent = Math.min(99, Math.round((got / total) * 100));
    }
    const blob = new Blob(chunks, { type: "image/jpeg" });
    return await createImageBitmap(blob);
  } catch {
    // fetch が使えないとき（ファイルを直接開いた場合など）
    return new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = url; });
  }
}

/* ---------- 2. シェーダー ---------- */
const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = vec2(aPos.x * .5 + .5, .5 - aPos.y * .5);
  gl_Position = vec4(aPos, 0., 1.);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec4 uRect;     // 画面に映す画像の範囲（0〜1）
uniform float uTime;
uniform float uMotion;  // 揺れの強さ（動きを減らす設定なら0）
uniform float uBright;
uniform float uFlash;
const vec2 SIZE = vec2(${IMG_W}.0, ${IMG_H}.0);

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0., a = .5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= .5; }
  return v;
}

// 楕円の中ほど1、外へ行くほど0になるやわらかい範囲
float region(vec2 P, vec2 c, vec2 r) {
  return 1. - smoothstep(.45, 1., length((P - c) / r));
}

// 付け根(anchor)から離れるほど大きく、波のように時間差をつけて揺らす
vec2 sway(vec2 P, vec2 c, vec2 r, vec2 anchor, vec2 dir, float amp, float speed, float phase) {
  float m = region(P, c, r);
  if (m <= 0.) return vec2(0.);
  float dist = length(P - anchor);
  float reach = clamp(dist / (max(r.x, r.y) * 1.6), 0., 1.);
  float w = sin(uTime * speed + phase - dist * .012)
          + .35 * sin(uTime * speed * 2.3 + phase * 1.7 - dist * .02);
  return normalize(dir) * amp * m * reach * w;
}

void main() {
  vec2 uv = uRect.xy + vUv * uRect.zw;
  vec2 P = uv * SIZE;  // 基準サイズでの座標（px）
  float t = uTime;

  vec2 d = vec2(0.);
  // 左の大きな袖
  d += sway(P, vec2(465., 400.), vec2(80., 175.), vec2(450., 230.), vec2(1., .15), 9., 1.3, 0.);
  // おさげ
  d += sway(P, vec2(575., 370.), vec2(45., 115.), vec2(590., 255.), vec2(1., .1), 6., 1.6, 1.);
  // 右の袖
  d += sway(P, vec2(985., 320.), vec2(140., 110.), vec2(860., 250.), vec2(.3, 1.), 10., 1.2, 2.);
  // 赤い紐
  d += sway(P, vec2(900., 305.), vec2(90., 70.), vec2(830., 270.), vec2(.2, 1.), 7., 2.1, .5);
  // 髪の先の飾り
  d += sway(P, vec2(900., 435.), vec2(75., 55.), vec2(850., 400.), vec2(1., .4), 8., 1.7, 3.);
  // 右下へ流れる長い裾
  d += sway(P, vec2(950., 525.), vec2(195., 95.), vec2(780., 480.), vec2(.1, 1.), 9., 1.1, 1.5);
  // 脚の間に垂れる前垂れ
  d += sway(P, vec2(640., 700.), vec2(55., 135.), vec2(630., 560.), vec2(1., 0.), 6., 1.4, 2.6);
  // 呼吸（胸元がわずかに上下する）
  d += (P - vec2(720., 620.)) * .006 * sin(t * 1.4) * region(P, vec2(720., 320.), vec2(130., 160.));

  d *= uMotion;
  vec2 suv = clamp(uv - d / SIZE, 0., 1.);
  vec3 col = texture(uTex, suv).rgb * uBright;

  // 手元の雷：細い筋がちらちら走る
  vec2 hp = (P - vec2(690., 212.)) / 95.;
  float rr = length(hp);
  if (rr < 1.4) {
    float flick = .55 + .45 * step(.45, noise(vec2(t * 9., 3.)));
    float ridge = 1. - abs(fbm(hp * 3.2 + vec2(t * 1.9, -t * 1.4)) - .5) * 2.;
    float vein = pow(ridge, 34.) * smoothstep(1.2, .1, rr);
    float glow = exp(-rr * rr * 5.) * (.32 + .12 * sin(t * 3.1));
    col += (vec3(.82, .58, 1.) * vein * 1.6 * flick + vec3(.55, .32, 1.) * glow) * uMotion;
  }
  // 刀を持つ手の上の光
  vec2 sp = (P - vec2(640., 95.)) / vec2(40., 70.);
  col += vec3(.6, .4, 1.) * exp(-dot(sp, sp) * 2.) * (.18 + .1 * sin(t * 2.3 + 1.)) * uMotion;
  // 月の光
  vec2 mp = (P - vec2(760., 35.)) / 90.;
  col += vec3(.5, .4, .9) * exp(-dot(mp, mp) * 2.5) * (.12 + .06 * sin(t * .9));

  // 稲光（画面全体が紫に光る）
  vec2 fp = vUv - vec2(.5, .3);
  col += vec3(.55, .35, 1.) * uFlash * (1. - smoothstep(0., .9, length(fp)));

  outColor = vec4(col, 1.);
}`;

function makeGL(img) {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
  if (!gl) return null;
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D); // 縮小表示でもギザギザしないように
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const u = (n) => gl.getUniformLocation(prog, n);
  return {
    gl,
    uRect: u("uRect"), uTime: u("uTime"), uMotion: u("uMotion"),
    uBright: u("uBright"), uFlash: u("uFlash"),
  };
}

/* ---------- 3. カメラ：画像のどこを画面に映すか ---------- */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, k) => a + (b - a) * k;

function cameraRect(p, mouse) {
  const imgAspect = IMG_W / IMG_H;
  const scrAspect = canvas.clientWidth / canvas.clientHeight;
  let w = 1, h = 1, cx = 0.5;
  if (scrAspect > imgAspect) h = imgAspect / scrAspect;
  else { w = scrAspect / imgAspect; cx = FOCUS_X_NARROW; }
  const k = Math.pow(p, 1.5);
  const z = 1 + ZOOM_MAX * k;
  w /= z; h /= z;
  cx = mix(cx, FOCUS[0], k) + mouse.x * 0.008;
  let cy = mix(0.5, FOCUS[1], k) + mouse.y * 0.008;
  cx = clamp(cx, w / 2, 1 - w / 2);
  cy = clamp(cy, h / 2, 1 - h / 2);
  return [cx - w / 2, cy - h / 2, w, h];
}

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
}

/* ---------- 4. スクロール量 → 文字の出入り ---------- */
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

function updateText(p) {
  scenes.forEach((el, i) => {
    const from = parseFloat(el.dataset.from);
    const to = parseFloat(el.dataset.to);
    const o = i === 0 ? (p <= from ? 1 : bell(p, -0.1, to)) : bell(p, from, to);
    el.style.opacity = o.toFixed(3);
    el.style.setProperty("--y", `${((1 - o) * 30).toFixed(1)}px`);
  });
  dots.forEach((d) => d.classList.toggle("on", p >= parseFloat(d.dataset.at)));
}

// 章が切り替わる瞬間と、ときどき遠くで光る稲光
function flashAmount(p, t) {
  if (reduceMotion) return 0;
  const chapter = Math.max(...dots.map((d) => Math.exp(-Math.pow((p - parseFloat(d.dataset.at)) * 60, 2))));
  const cycle = t % 7;
  const ambient = cycle > 6.2 ? Math.max(0, Math.sin((cycle - 6.2) * 40)) * 0.25 * Math.exp(-(cycle - 6.2) * 4) : 0;
  return Math.max(chapter, ambient);
}

/* ---------- 5. 毎フレームの描画 ---------- */
function start(img) {
  let ctx;
  try { ctx = makeGL(img); } catch (e) { console.warn(e); ctx = null; }
  const ctx2d = ctx ? null : canvas.getContext("2d");

  let p = heroProgress();
  const mouse = { x: 0, y: 0 }, mouseTarget = { x: 0, y: 0 };
  addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    mouseTarget.x = (e.clientX / innerWidth - 0.5) * 2;
    mouseTarget.y = (e.clientY / innerHeight - 0.5) * 2;
  });

  const t0 = performance.now();
  (function frame(now) {
    const t = reduceMotion ? 0 : (now - t0) / 1000;
    p += (heroProgress() - p) * (reduceMotion ? 1 : 0.12);
    mouse.x += (mouseTarget.x - mouse.x) * 0.05;
    mouse.y += (mouseTarget.y - mouse.y) * 0.05;

    const heroVisible = hero.getBoundingClientRect().bottom > 0;
    if (heroVisible) {
      const rect = cameraRect(p, mouse);
      const bright = mix(0.6, 1.0, clamp(p / 0.14, 0, 1));
      const f = flashAmount(p, t);
      if (ctx) {
        const { gl } = ctx;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform4f(ctx.uRect, ...rect);
        gl.uniform1f(ctx.uTime, t);
        gl.uniform1f(ctx.uMotion, reduceMotion ? 0 : 1);
        gl.uniform1f(ctx.uBright, bright);
        gl.uniform1f(ctx.uFlash, f * 0.6);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else {
        // WebGL が使えないときは止まった絵だけ描く
        const W = img.width, H = img.height;
        ctx2d.drawImage(img, rect[0] * W, rect[1] * H, rect[2] * W, rect[3] * H, 0, 0, canvas.width, canvas.height);
      }
      flash.style.opacity = (f * 0.7).toFixed(3);
      updateText(p);
    }
    requestAnimationFrame(frame);
  })(performance.now());
}

/* ---------- 6. 下のセクションをふわっと出す ---------- */
const io = new IntersectionObserver(
  (entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }),
  { threshold: 0.15 }
);
document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

/* ---------- 7. 舞い散る紫の花びら ---------- */
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
      g.scale(1, Math.abs(Math.sin(pt.sway * 0.7)) * 0.6 + 0.4);
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

loadImage("img/hero.jpg").then((img) => {
  loaderNum.textContent = 100;
  resizeCanvas();
  start(img);
  loader.classList.add("done");
  document.body.classList.remove("loading");
  if (!reduceMotion) startPetals();
});
