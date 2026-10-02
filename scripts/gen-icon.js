'use strict';
/**
 * 纯 Node 光栅化应用图标（零依赖，替代 Electron capturePage 的 DPI 兼容问题）。
 * 设计稿见 scripts/icon.svg：深色圆角底 + 渐变循环切换箭头 + 发光白色闪电。
 * 产物：build/icon.png(1024) / build/icon-256.png / electron/tray.png(32)
 * 运行：node scripts/gen-icon.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const N = 1024;          // 输出尺寸
const SS = 3;            // 每像素超采样数（每边）
const projectRoot = path.join(__dirname, '..');

// ---------------- 调色与几何（与 icon.svg 一致，1024 坐标系） ----------------
const BG0 = [35, 35, 68], BG1 = [13, 13, 23];           // 底色渐变 #232344 → #0d0d17
const RG0 = [124, 140, 255], RG1 = [157, 107, 255];     // 箭头渐变 #7c8cff → #9d6bff
const BT0 = [255, 255, 255], BT1 = [195, 205, 255];     // 闪电渐变 #ffffff → #c3cdff
const GLOW = [108, 123, 255];                           // 辉光 #6c7bff

const CX = 512, CY = 512;
const RR = 512, RR_R = 230;                             // 圆角矩形
const RING_R = 330, RING_W = 66;                        // 环半径/线宽
const DEG = Math.PI / 180;
const ARCS = [[-72 * DEG, 72 * DEG], [108 * DEG, 252 * DEG]]; // 两段弧的角度范围
const ARC_PTS = [[614, 198], [614, 826], [410, 826], [410, 198]]; // 弧端点（round caps）
const BOLT = [[600, 170], [380, 555], [505, 555], [435, 850], [665, 445], [528, 445]];
// 箭头三角：弧末端沿切线方向
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c0, c1, t) => [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
const triOf = (E, t, n) => ({
  tip: [E[0] + t[0] * 160, E[1] + t[1] * 160],
  a: [E[0] + t[0] * 25 + n[0] * 70, E[1] + t[1] * 25 + n[1] * 70],
  b: [E[0] + t[0] * 25 - n[0] * 70, E[1] + t[1] * 25 - n[1] * 70],
});
const TRIS = [
  triOf([614, 826], [-0.951, 0.309], [-0.309, -0.951]),
  triOf([410, 198], [0.951, -0.309], [0.309, 0.951]),
];

// ---------------- 几何判定 ----------------
function inRoundedRect(x, y) {
  const qx = Math.abs(x - CX) - (RR - RR_R);
  const qy = Math.abs(y - CY) - (RR - RR_R);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  const d = Math.hypot(ax, ay) - RR_R + Math.min(Math.max(qx, qy), 0);
  return d < 0;
}

function angleInArc(theta, range) {
  let [a, b] = range;
  if (a <= b) return theta >= a && theta <= b;
  return theta >= a || theta <= b; // 跨 ±π 的弧
}

function inRing(x, y) {
  const dx = x - CX, dy = y - CY;
  const d = Math.hypot(dx, dy);
  if (Math.abs(d - RING_R) > RING_W / 2) return false;
  const theta = Math.atan2(dy, dx);
  for (const range of ARCS) if (angleInArc(theta, range)) return true;
  // round caps：弧端点半圆
  for (const [px, py] of ARC_PTS) {
    if (Math.hypot(x - px, y - py) <= RING_W / 2) return true;
  }
  return false;
}

function inTri(x, y, T) {
  const s = (p, a, b) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const d1 = s([x, y], T.a, T.tip), d2 = s([x, y], T.tip, T.b), d3 = s([x, y], T.b, T.a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function inBolt(x, y) {
  let inside = false;
  for (let i = 0, j = BOLT.length - 1; i < BOLT.length; j = i++) {
    const [xi, yi] = BOLT[i], [xj, yj] = BOLT[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------- 主渲染 ----------------
const px = Buffer.alloc(N * N * 4);
const glowMask = new Float32Array(N * N);

// 1) 几何掩码（辉光用，1x 分辨率）
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    if (inRing(x, y) || inBolt(x, y) || TRIS.some((T) => inTri(x, y, T))) glowMask[y * N + x] = 1;
  }
}

// 2) 盒式模糊 ×3 近似高斯（辉光）
function boxBlur(src, radius) {
  const tmp = new Float32Array(N * N);
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += src[y * N + Math.min(N - 1, Math.max(0, k))];
    for (let x = 0; x < N; x++) {
      tmp[y * N + x] = sum / (radius * 2 + 1);
      const add = src[y * N + Math.min(N - 1, x + radius + 1)];
      const sub = src[y * N + Math.max(0, x - radius)];
      sum += add - sub;
    }
  }
  for (let x = 0; x < N; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += tmp[Math.min(N - 1, Math.max(0, k)) * N + x];
    for (let y = 0; y < N; y++) {
      out[y * N + x] = sum / (radius * 2 + 1);
      const add = tmp[Math.min(N - 1, y + radius + 1) * N + x];
      const sub = tmp[Math.max(0, y - radius) * N + x];
      sum += add - sub;
    }
  }
  return out;
}
let glow = boxBlur(glowMask, 20);
glow = boxBlur(glow, 16);
glow = boxBlur(glow, 12);

// 3) 逐像素合成（超采样抗锯齿）
const offs = [];
for (let i = 0; i < SS; i++) offs.push((i + 0.5) / SS - 0.5);

for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    let covBg = 0, covGlyph = 0, gr = 0, gg = 0, gb = 0;
    for (const ox of offs) for (const oy of offs) {
      const sx = x + 0.5 + ox, sy = y + 0.5 + oy;
      if (!inRoundedRect(sx, sy)) continue;
      covBg++;
      const hitBolt = inBolt(sx, sy);
      const hitRing = !hitBolt && (inRing(sx, sy) || TRIS.some((T) => inTri(sx, sy, T)));
      if (!hitBolt && !hitRing) continue;
      covGlyph++;
      const td = (sx + sy) / 2048;             // 对角渐变（底/环）
      if (hitBolt) {
        const t = Math.min(1, Math.max(0, (sy - 170) / 680));
        const c = mix(BT0, BT1, t);
        gr += c[0]; gg += c[1]; gb += c[2];
      } else {
        const c = mix(RG0, RG1, td);
        gr += c[0]; gg += c[1]; gb += c[2];
      }
    }
    if (covBg === 0) continue; // 完全透明
    const aBg = covBg / (SS * SS);
    const cBg = mix(BG0, BG1, (x + y) / 2048);
    let r = cBg[0], g = cBg[1], b = cBg[2];
    // 辉光（裁剪在底板内）
    const ga = Math.min(1, glow[y * N + x]) * 0.55 * aBg;
    r = r * (1 - ga) + GLOW[0] * ga;
    g = g * (1 - ga) + GLOW[1] * ga;
    b = b * (1 - ga) + GLOW[2] * ga;
    // 图形（箭头 + 闪电）
    const aG = covGlyph / (SS * SS);
    if (aG > 0) {
      r = r * (1 - aG) + (gr / covGlyph) * aG;
      g = g * (1 - aG) + (gg / covGlyph) * aG;
      b = b * (1 - aG) + (gb / covGlyph) * aG;
    }
    const o = (y * N + x) * 4;
    px[o] = Math.round(r); px[o + 1] = Math.round(g); px[o + 2] = Math.round(b); px[o + 3] = Math.round(aBg * 255);
  }
}

// ---------------- PNG 编码 ----------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(rgba, w, h) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// 降采样（块平均）
function downscale(src, from, to) {
  const out = Buffer.alloc(to * to * 4);
  const f = from / to;
  for (let y = 0; y < to; y++) {
    for (let x = 0; x < to; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = Math.floor(y * f); sy < Math.floor((y + 1) * f); sy++) {
        for (let sx = Math.floor(x * f); sx < Math.floor((x + 1) * f); sx++) {
          const o = (sy * from + sx) * 4;
          r += src[o]; g += src[o + 1]; b += src[o + 2]; a += src[o + 3]; n++;
        }
      }
      const o = (y * to + x) * 4;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n); out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

const outDir = path.join(projectRoot, 'build');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.png'), encodePng(px, N, N));
fs.writeFileSync(path.join(outDir, 'icon-256.png'), encodePng(downscale(px, N, 256), 256, 256));
fs.writeFileSync(path.join(projectRoot, 'electron', 'tray.png'), encodePng(downscale(px, N, 32), 32, 32));
console.log('icon generated: build/icon.png (1024), build/icon-256.png, electron/tray.png');
