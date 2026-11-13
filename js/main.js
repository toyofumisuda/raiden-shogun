// 雷電将軍サイト
// しくみ: AIで拡大した3枚の絵を WebGL で描く。
//   場面A（第一章・第二章）: 立ち絵。袖・おさげ・赤い紐・裾が風で揺れ、手元に雷が走る
//   場面C（間奏）        : 巴紋の目。まぶたが開き、巴紋が回り、光の帯が流れる
//   場面B（第三章・第四章）: 元素爆発で刀を抜く場面。髪と裾がなびき、刀と光の柱が輝く
//   A → C → B の切り替わりでは、稲光が走る。
//   スクロール量に合わせてカメラが寄り、章の切り替えでも稲光が走る。

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// 各場面の設定。size は座標を決めたときの基準サイズ（px）
const SCENES = [
  {
    src: "img/hero.jpg", size: [1480, 832],
    narrowX: 0.49,               // スマホで左右を切るときに残す中心
    focus: [0.49, 0.30],         // 寄っていく先（顔）
    zoom: [1.0, 1.32],
    range: [0, 0.45],            // この場面が映るスクロール範囲
  },
  {
    src: "img/hero2.jpg", size: [1780, 1000],
    narrowX: 0.27,
    focus: [0.33, 0.36],
    zoom: [1.06, 1.3],
    range: [0.63, 1],
  },
  {
    src: "img/hero3.jpg", size: [720, 480],
    narrowX: 0.519,
    focus: [0.519, 0.467],       // 巴紋の中心
    zoom: [1.0, 1.5],
    range: [0.45, 0.63],
  },
];
// 絵が切り替わる位置： 立ち絵 →（目）→ 刀を抜く場面
const SWITCH_1 = 0.45;  // A → C
const SWITCH_2 = 0.63;  // C → B（第三章の手前）

const hero = document.getElementById("hero");
const canvas = document.getElementById("heroCanvas");
const flash = document.getElementById("flash");
const scenes = [...document.querySelectorAll(".scene")];
const dots = [...document.querySelectorAll(".progress li")];
const loader = document.getElementById("loader");
const loaderNum = document.getElementById("loaderNum");

document.body.classList.add("loading");

/* ---------- 1. 画像を読み込む（進み具合を%で表示） ---------- */
const progress = SCENES.map(() => 0);
const showProgress = () =>
  (loaderNum.textContent = Math.min(99, Math.round((progress.reduce((a, b) => a + b, 0) / SCENES.length) * 100)));

async function loadImage(url, i) {
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
      if (total) { progress[i] = got / total; showProgress(); }
    }
    return await createImageBitmap(new Blob(chunks, { type: "image/jpeg" }));
  } catch {
    // fetch が使えないとき（ファイルを直接開いた場合など）
    return new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.src = url; });
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
uniform sampler2D uTexA, uTexB, uTexC;
uniform vec4 uRectA, uRectB, uRectC;  // それぞれの絵の、画面に映す範囲（0〜1）
uniform float uMix1;  // 0 = 場面A、1 = 場面C
uniform float uMix2;  // 0 = 場面C、1 = 場面B
uniform float uOpen;  // 目の開き具合（0 = 閉じている）
uniform float uSpin;  // 巴紋の回転角
uniform float uTime, uMotion, uBright, uFlash;
const vec2 SIZE_A = vec2(${SCENES[0].size[0]}.0, ${SCENES[0].size[1]}.0);
const vec2 SIZE_B = vec2(${SCENES[1].size[0]}.0, ${SCENES[1].size[1]}.0);
const vec2 SIZE_C = vec2(${SCENES[2].size[0]}.0, ${SCENES[2].size[1]}.0);

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

// 雷の筋（中心 c、半径 r の円の中にちらちら走る）
vec3 sparks(vec2 P, vec2 c, float r, float seed, float strength) {
  vec2 hp = (P - c) / r;
  float rr = length(hp);
  if (rr > 1.4) return vec3(0.);
  float t = uTime;
  float flick = .55 + .45 * step(.45, noise(vec2(t * 9., seed)));
  float ridge = 1. - abs(fbm(hp * 3.2 + vec2(t * 1.9 + seed, -t * 1.4)) - .5) * 2.;
  float vein = pow(ridge, 34.) * smoothstep(1.2, .1, rr);
  float glow = exp(-rr * rr * 5.) * (.3 + .12 * sin(t * 3.1 + seed));
  return (vec3(.82, .58, 1.) * vein * 1.6 * flick + vec3(.55, .32, 1.) * glow) * strength;
}

// ---- 場面A：立ち絵 ----
vec3 sceneA(vec2 vUv) {
  vec2 uv = uRectA.xy + vUv * uRectA.zw;
  vec2 P = uv * SIZE_A;
  float t = uTime;
  vec2 d = vec2(0.);
  d += sway(P, vec2(465., 400.), vec2(80., 175.), vec2(450., 230.), vec2(1., .15), 9., 1.3, 0.);   // 左の袖
  d += sway(P, vec2(575., 370.), vec2(45., 115.), vec2(590., 255.), vec2(1., .1), 6., 1.6, 1.);    // おさげ
  d += sway(P, vec2(985., 320.), vec2(140., 110.), vec2(860., 250.), vec2(.3, 1.), 10., 1.2, 2.);  // 右の袖
  d += sway(P, vec2(900., 305.), vec2(90., 70.), vec2(830., 270.), vec2(.2, 1.), 7., 2.1, .5);     // 赤い紐
  d += sway(P, vec2(900., 435.), vec2(75., 55.), vec2(850., 400.), vec2(1., .4), 8., 1.7, 3.);     // 髪先の飾り
  d += sway(P, vec2(950., 525.), vec2(195., 95.), vec2(780., 480.), vec2(.1, 1.), 9., 1.1, 1.5);   // 長い裾
  d += sway(P, vec2(640., 700.), vec2(55., 135.), vec2(630., 560.), vec2(1., 0.), 6., 1.4, 2.6);   // 前垂れ
  d += (P - vec2(720., 620.)) * .006 * sin(t * 1.4) * region(P, vec2(720., 320.), vec2(130., 160.)); // 呼吸
  d *= uMotion;

  vec3 col = texture(uTexA, clamp(uv - d / SIZE_A, 0., 1.)).rgb;
  col += sparks(P, vec2(690., 212.), 95., 3., uMotion);  // 手元の雷
  vec2 sp = (P - vec2(640., 95.)) / vec2(40., 70.);       // 刀を持つ手の上の光
  col += vec3(.6, .4, 1.) * exp(-dot(sp, sp) * 2.) * (.18 + .1 * sin(t * 2.3 + 1.)) * uMotion;
  vec2 mp = (P - vec2(760., 35.)) / 90.;                  // 月の光
  col += vec3(.5, .4, .9) * exp(-dot(mp, mp) * 2.5) * (.12 + .06 * sin(t * .9));
  return col;
}

// ---- 場面B：刀を抜く ----
vec3 sceneB(vec2 vUv) {
  vec2 uv = uRectB.xy + vUv * uRectB.zw;
  vec2 P = uv * SIZE_B;
  float t = uTime;
  vec2 d = vec2(0.);
  d += sway(P, vec2(640., 330.), vec2(180., 170.), vec2(450., 190.), vec2(1., .25), 11., 1.5, 0.);  // 右へなびく髪
  d += sway(P, vec2(930., 320.), vec2(70., 170.), vec2(930., 170.), vec2(1., .2), 7., 1.9, 1.2);    // 飾り紐
  d += sway(P, vec2(760., 720.), vec2(300., 180.), vec2(450., 560.), vec2(.7, 1.), 13., 1.3, 2.);   // 流れる裾
  d += sway(P, vec2(200., 620.), vec2(90., 160.), vec2(260., 470.), vec2(-.3, 1.), 6., 1.6, .7);    // 左の袖
  // 光の柱のゆらめき（横に細かく震える）
  float pillar = smoothstep(1020., 1250., P.x);
  d.x += (noise(vec2(P.y * .01, t * 3.)) - .5) * 10. * pillar;
  d *= uMotion;

  vec3 col = texture(uTexB, clamp(uv - d / SIZE_B, 0., 1.)).rgb;

  // 光の柱：下から上へ流れる筋
  float streak = noise(vec2(P.x * .025, P.y * .003 + t * 1.8)) * noise(vec2(P.x * .06, P.y * .002 + t * 2.6));
  col += vec3(.75, .5, 1.) * pow(streak, 2.) * .7 * pillar * uMotion;

  // 刀身を走る光（つばから切っ先へ）
  vec2 a = vec2(960., 712.), b = vec2(1780., 975.);
  vec2 ab = b - a;
  float s = clamp(dot(P - a, ab) / dot(ab, ab), 0., 1.);
  float distL = length(P - (a + ab * s));
  float glintPos = fract(t * .35);
  float glint = exp(-pow((s - glintPos) * 9., 2.)) * exp(-distL * distL / 60.);
  col += vec3(1., .85, 1.) * glint * 1.3 * uMotion;
  col += vec3(.6, .4, 1.) * exp(-distL * distL / 900.) * (.12 + .08 * sin(t * 5.)) * step(.001, s) * uMotion;

  // 雷の筋：右手の巴の玉、左手のまわり、髪の上を走る稲妻
  col += sparks(P, vec2(920., 470.), 110., 7., uMotion);
  col += sparks(P, vec2(235., 440.), 95., 11., uMotion * .9);
  col += sparks(P, vec2(800., 300.), 120., 5., uMotion * .7);

  // 目の光
  vec2 e1 = (P - vec2(392., 243.)) / 22., e2 = (P - vec2(452., 243.)) / 22.;
  float eye = exp(-dot(e1, e1) * 2.) + exp(-dot(e2, e2) * 2.);
  col += vec3(.7, .45, 1.) * eye * (.25 + .15 * sin(t * 2.)) * uMotion;
  return col;
}

// ---- 場面C：巴紋の目 ----
vec3 sceneC(vec2 vUv) {
  vec2 uv = uRectC.xy + vUv * uRectC.zw;
  vec2 P = uv * SIZE_C;
  float t = uTime;
  vec2 c = vec2(374., 224.);  // 巴紋の中心
  vec2 q = P - c;
  float r = length(q);

  // 巴紋を回す（瞳の内側だけ。外側へ行くほど回転を弱めてなじませる）
  float rot = uSpin * (1. - smoothstep(52., 80., r));
  float cs = cos(rot), sn = sin(rot);
  vec2 Pr = c + mat2(cs, -sn, sn, cs) * q;

  // 目のまわりの光の帯をゆらめかせる
  float band = region(P, vec2(370., 225.), vec2(340., 150.)) * smoothstep(70., 110., r);
  Pr.x += (noise(vec2(P.y * .05, t * 2.)) - .5) * 8. * band * uMotion;
  Pr.y += sin(P.x * .03 - t * 3.) * 2. * band * uMotion;

  vec3 col = texture(uTexC, clamp(Pr / SIZE_C, 0., 1.)).rgb;

  // 光の帯の上を、明るい筋が流れていく
  float flow = noise(vec2(P.x * .012 - t * 1.4, P.y * .09));
  col += vec3(.65, .5, 1.) * pow(flow, 3.) * band * .7 * uMotion;

  // 星のまたたき（明るい点だけ、場所ごとにずらして明滅）
  float lum = dot(col, vec3(.3, .5, .2));
  float twinkle = .5 + .5 * sin(t * 2.2 + noise(P * .02) * 6.);
  col += col * smoothstep(.6, .95, lum) * (1. - band) * smoothstep(70., 100., r) * twinkle * .5 * uMotion;

  // 巴紋のまわりの光
  col += vec3(.7, .5, 1.) * exp(-r * r / 4900.) * (.22 + .14 * sin(t * 2.5)) * uMotion;

  // まぶた：上下から閉じた黒が、目の形に開いていく
  float hx = max(1. - pow((P.x - 370.) / 430., 2.), 0.);
  float lid = uOpen * 170. * hx + smoothstep(.75, 1., uOpen) * 600.;
  col *= 1. - smoothstep(lid - 25., lid, abs(P.y - 224.));
  return col;
}

void main() {
  vec3 col;
  if (uMix2 >= .999) col = sceneB(vUv);
  else if (uMix1 <= .001) col = sceneA(vUv);
  else if (uMix2 <= .001) col = uMix1 >= .999 ? sceneC(vUv) : mix(sceneA(vUv), sceneC(vUv), uMix1);
  else col = mix(sceneC(vUv), sceneB(vUv), uMix2);
  col *= uBright;

  // 稲光（画面全体が紫に光る）
  vec2 fp = vUv - vec2(.5, .3);
  col += vec3(.55, .35, 1.) * uFlash * (1. - smoothstep(0., .9, length(fp)));
  outColor = vec4(col, 1.);
}`;

function makeGL(imgs) {
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

  imgs.forEach((img, i) => {
    gl.activeTexture(gl.TEXTURE0 + i);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D); // 縮小表示でもギザギザしないように
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  });

  const u = (n) => gl.getUniformLocation(prog, n);
  gl.uniform1i(u("uTexA"), 0);
  gl.uniform1i(u("uTexB"), 1);
  gl.uniform1i(u("uTexC"), 2);
  return {
    gl,
    uRectA: u("uRectA"), uRectB: u("uRectB"), uRectC: u("uRectC"),
    uMix1: u("uMix1"), uMix2: u("uMix2"), uOpen: u("uOpen"), uSpin: u("uSpin"),
    uTime: u("uTime"), uMotion: u("uMotion"), uBright: u("uBright"), uFlash: u("uFlash"),
  };
}

/* ---------- 3. カメラ：絵のどこを画面に映すか ---------- */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, k) => a + (b - a) * k;

function cameraRect(sc, p, mouse) {
  const imgAspect = sc.size[0] / sc.size[1];
  const scrAspect = canvas.clientWidth / canvas.clientHeight;
  let w = 1, h = 1, cx = 0.5;
  if (scrAspect > imgAspect) h = imgAspect / scrAspect;
  else { w = scrAspect / imgAspect; cx = sc.narrowX; }
  const k = Math.pow(clamp((p - sc.range[0]) / (sc.range[1] - sc.range[0]), 0, 1), 1.4);
  const z = mix(sc.zoom[0], sc.zoom[1], k);
  w /= z; h /= z;
  const narrow = scrAspect <= imgAspect;
  cx = mix(cx, narrow ? sc.narrowX : sc.focus[0], k) + mouse.x * 0.008;
  let cy = mix(0.5, sc.focus[1], k) + mouse.y * 0.008;
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
  // 絵が切り替わるときは強く
  const sw = Math.max(...[SWITCH_1, SWITCH_2].map((s) => Math.exp(-Math.pow((p - s) * 45, 2)))) * 1.4;
  const cycle = t % 7;
  const ambient = cycle > 6.2 ? Math.max(0, Math.sin((cycle - 6.2) * 40)) * 0.25 * Math.exp(-(cycle - 6.2) * 4) : 0;
  return Math.max(chapter, sw, ambient);
}

/* ---------- 5. 毎フレームの描画 ---------- */
function start(imgs) {
  let ctx;
  try { ctx = makeGL(imgs); } catch (e) { console.warn(e); ctx = null; }
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

    if (hero.getBoundingClientRect().bottom > 0) {
      const rectA = cameraRect(SCENES[0], p, mouse);
      const rectB = cameraRect(SCENES[1], p, mouse);
      const rectC = cameraRect(SCENES[2], p, mouse);
      const m1 = clamp((p - (SWITCH_1 - 0.006)) / 0.012, 0, 1);
      const m2 = clamp((p - (SWITCH_2 - 0.006)) / 0.012, 0, 1);
      const kc = clamp((p - SWITCH_1) / (SWITCH_2 - SWITCH_1), 0, 1); // 目の場面の進み具合
      const open = kc < 0.4 ? 0.5 - 0.5 * Math.cos((kc / 0.4) * Math.PI) : 1;
      const bright = mix(0.6, 1.0, clamp(p / 0.1, 0, 1));
      const f = flashAmount(p, t);
      if (ctx) {
        const { gl } = ctx;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform4f(ctx.uRectA, ...rectA);
        gl.uniform4f(ctx.uRectB, ...rectB);
        gl.uniform4f(ctx.uRectC, ...rectC);
        gl.uniform1f(ctx.uMix1, m1);
        gl.uniform1f(ctx.uMix2, m2);
        gl.uniform1f(ctx.uOpen, reduceMotion ? 1 : open);
        gl.uniform1f(ctx.uSpin, t * 0.5 + kc * 4.0); // 時間で回り、スクロールでさらに回る
        gl.uniform1f(ctx.uTime, t);
        gl.uniform1f(ctx.uMotion, reduceMotion ? 0 : 1);
        gl.uniform1f(ctx.uBright, bright);
        gl.uniform1f(ctx.uFlash, f * 0.6);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else {
        // WebGL が使えないときは止まった絵だけ描く
        const i = m2 >= 0.5 ? 1 : m1 >= 0.5 ? 2 : 0;
        const img = imgs[i], r = [rectA, rectB, rectC][i];
        ctx2d.drawImage(img, r[0] * img.width, r[1] * img.height, r[2] * img.width, r[3] * img.height,
          0, 0, canvas.width, canvas.height);
      }
      flash.style.opacity = Math.min(1, f * 0.7).toFixed(3);
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

Promise.all(SCENES.map((s, i) => loadImage(s.src, i))).then((imgs) => {
  loaderNum.textContent = 100;
  resizeCanvas();
  start(imgs);
  loader.classList.add("done");
  document.body.classList.remove("loading");
  if (!reduceMotion) startPetals();
});
