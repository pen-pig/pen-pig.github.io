#!/usr/bin/env node
/* ============================================================
   pen-pig 评论网关（comment gateway）
   ------------------------------------------------------------
   职责只有三件，都是「守门」，不存内容：
     1. 生成图形验证码（服务端签发答案，客户端永远拿不到明文）
     2. 按来源 IP 限流：10 秒内最多 2 次
     3. 存进本地 JSON 文件（data/comments.json）

   评论存在网关自己的 JSON 文件里（data/comments.json）：
     - 不依赖任何外部服务，不需要 token，也没有密钥可泄漏
     - 写入用「临时文件 + rename」保证原子性
     - 读改写加串行锁，避免并发提交互相覆盖

   零依赖：只用 Node 标准库，部署时无需 npm install。
   运行：node server.js   （读 PORT 环境变量）
   ============================================================ */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const https = require("https");

/* ---------------- 配置 ---------------- */

const PORT = process.env.PORT || 8787;
const DATA_FILE = path.join(__dirname, "data", "comments.json");
const RATE_FILE = path.join(__dirname, "data", "ratelimit.json");
const UPLOAD_DIR = path.join(__dirname, "data", "uploads");
// 实例标识：线上是多副本负载均衡，用来确认请求落到了哪个副本
const INSTANCE_ID = require("crypto").randomBytes(3).toString("hex");

// 限流：10 秒 2 次；另加每小时 20 次的兜底，防止慢速刷屏
// 阈值可用环境变量覆盖（本地联调 / 压测时放开）
const WINDOW_MS = parseInt(process.env.RATE_WINDOW_MS || String(10 * 1000), 10);
const WINDOW_MAX = parseInt(process.env.RATE_WINDOW_MAX || "2", 10);
const HOUR_MS = parseInt(process.env.RATE_HOUR_MS || String(60 * 60 * 1000), 10);
const HOUR_MAX = parseInt(process.env.RATE_HOUR_MAX || "20", 10);

const CAPTCHA_TTL_MS = 5 * 60 * 1000;

// Cloudflare Turnstile: free tier, unlimited, no CF proxy required.
// Configured -> use Turnstile; otherwise fall back to the local PNG captcha.
// Either way the verdict is decided on the server only.
const TURNSTILE_SITE_KEY = (process.env.TURNSTILE_SITE_KEY || "").trim();
const TURNSTILE_SECRET_KEY = (process.env.TURNSTILE_SECRET_KEY || "").trim();
const USE_TURNSTILE = !!(TURNSTILE_SITE_KEY && TURNSTILE_SECRET_KEY);
const MAX_CONTENT = 1000;
const MAX_NICK = 24;

// 讨论区配图：允许的类型与上限（对应社团的讨论区：jpg/png/gif/webp）
const IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp"
};
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;   // 单张 2MB
const IMAGE_NAME_RE = /^img_[0-9a-f]{16}\.(jpg|png|gif|webp)$/;

/* ---------------- 工具 ---------------- */

function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) {
    const first = String(xff).split(",")[0].trim();
    if (first) return first;
  }
  const real = req.headers["x-real-ip"];
  if (real) return String(real).trim();
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

function json(res, code, obj, extraHeaders) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(code, Object.assign({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers": "X-Captcha-Id"
  }, extraHeaders || {}));
  res.end(body);
}

function clean(s, max) {
  var str = String(s == null ? "" : s);
  var out = "";
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    // 丢弃控制字符（< 0x20）与 DEL，保留可打印字符与中文
    if (c < 0x20 || c === 0x7f) continue;
    out += str.charAt(i);
  }
  return out.trim().slice(0, max);
}

/* ---------------- 讨论区扩展：配图 / 删除码 ----------------
   博客评论区按「社团讨论区」的模型扩展：楼号、回复某楼、配图、删自己的评论。
   匿名没有账号体系，所以用「删除码」代替密码：
   发评论时服务端随机生成一段明文只回给提交者一次，库里只留哈希，
   之后凭删除码就能删掉自己那条。
------------------------------------------------ */

function sha256hex(s) {
  return require("crypto").createHash("sha256").update(String(s)).digest("hex");
}

// 对外输出时抹掉删除码哈希等内部字段
function publicComment(c) {
  return {
    id: c.id,
    post: c.post,
    nickname: c.nickname || "匿名",
    content: c.content || "",
    created_at: c.created_at,
    floor: typeof c.floor === "number" ? c.floor : 0,
    replyTo: typeof c.replyTo === "number" ? c.replyTo : 0,
    replyToNick: c.replyToNick || "",
    image: c.image || ""
  };
}

// 解析并落盘一张配图：接收 data URL，返回存储文件名（失败返回空串）
function saveImage(dataUrl) {
  if (!dataUrl) return "";
  var m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl));
  if (!m) return "";
  var mime = m[1].toLowerCase();
  var ext = IMAGE_TYPES[mime];
  if (!ext) return "";
  var raw;
  try {
    raw = Buffer.from(m[2].replace(/\s+/g, ""), "base64");
  } catch (e) { return ""; }
  if (!raw.length || raw.length > MAX_IMAGE_BYTES) return "";
  // 魔数校验：不能只信 MIME 头
  var ok = false;
  if (ext === "jpg") ok = raw[0] === 0xff && raw[1] === 0xd8 && raw[2] === 0xff;
  else if (ext === "png") ok = raw[0] === 0x89 && raw[1] === 0x50 && raw[2] === 0x4e && raw[3] === 0x47;
  else if (ext === "gif") ok = raw.slice(0, 3).toString("latin1") === "GIF";
  else if (ext === "webp") ok = raw.slice(0, 4).toString("latin1") === "RIFF" && raw.slice(8, 12).toString("latin1") === "WEBP";
  if (!ok) return "";
  var name = "img_" + require("crypto").randomBytes(8).toString("hex") + "." + ext;
  try {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, name), raw);
  } catch (e) { return ""; }
  return name;
}

function removeImage(name) {
  if (!name || !IMAGE_NAME_RE.test(name)) return;
  try { fs.unlinkSync(path.join(UPLOAD_DIR, name)); } catch (e) {}
}

// 删掉一条评论：命中返回 true
function deleteCommentById(id) {
  var removed = null;
  writeChain = writeChain.then(async () => {
    var arr = localAll();
    var rest = [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].id === id) removed = arr[i];
      else rest.push(arr[i]);
    }
    if (removed) writeFileAtomic(rest);
  });
  return writeChain.then(function () { return removed; });
}

/* ---------------- 图形验证码 ----------------
   纯手写 PNG 编码 + 5x7 点阵字模：
   字符以像素点阵绘制（不是文字），图像里没有可解析的字符，
   机器只能 OCR，纯前端方案做不到这一点。
------------------------------------------------ */

const GLYPHS = {
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  "=": [".....", ".....", "#####", ".....", "#####", ".....", "....."],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  "x": [".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "....."]
};

// CRC32（PNG 分块校验）
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

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgb) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const ro = y * (1 + width * 3);
    raw[ro] = 0;
    rgb.copy(raw, ro + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // color type: truecolor
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function renderCaptcha(text) {
  const scale = 6;
  const gw = 5, gh = 7;
  const gap = 3;
  const cellW = gw * scale;
  const cellH = gh * scale;
  const padX = 12, padY = 14;
  // 画布宽度固定（前端 CSS 也按这个宽度写死），算式短时居中留白，
  // 这样不同算式的验证码图尺寸一致，前端不会拉伸变形
  const width = 186;
  const height = padY * 2 + cellH;
  const textW = text.length * (cellW + gap) - gap;
  const px = Buffer.alloc(width * height * 3);

  // 背景：深色 + 轻微渐变噪声
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const n = (Math.random() * 14) | 0;
      px[i] = 8 + n; px[i + 1] = 14 + n; px[i + 2] = 20 + n;
    }
  }

  function setPixel(x, y, r, g, b) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 3;
    px[i] = r; px[i + 1] = g; px[i + 2] = b;
  }

  // 干扰线
  for (let i = 0; i < 5; i++) {
    const x0 = Math.random() * width, y0 = Math.random() * height;
    const x1 = Math.random() * width, y1 = Math.random() * height;
    const c = [Math.random() * 120 + 40, Math.random() * 120 + 40, Math.random() * 120 + 40];
    const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
    for (let s = 0; s <= steps; s++) {
      const t = steps ? s / steps : 0;
      setPixel(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), c[0], c[1], c[2]);
    }
  }
  // 噪点
  for (let i = 0; i < width * height / 8; i++) {
    const c = Math.random() * 90 + 60;
    setPixel((Math.random() * width) | 0, (Math.random() * height) | 0, c, c, c);
  }

  // 字符：每个字符独立竖直偏移 + 错位，绿色系
  const palette = [[70, 243, 167], [255, 180, 84], [120, 220, 255], [180, 255, 120]];
  let cx = Math.max(padX, Math.round((width - textW) / 2));   // 居中
  for (const ch of text) {
    if (ch === " ") { cx += Math.round(cellW * 0.6); continue; }
    const glyph = GLYPHS[ch] || GLYPHS["?"];
    const color = palette[(Math.random() * palette.length) | 0];
    const dy = ((Math.random() * 5) | 0) - 2;
    const dx = ((Math.random() * 3) | 0) - 1;
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        if (glyph[gy][gx] !== "#") continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            setPixel(cx + gx * scale + sx + dx, padY + gy * scale + sy + dy,
              color[0], color[1], color[2]);
          }
        }
      }
    }
    cx += cellW + gap;
  }
  return encodePng(width, height, px);
}

// 线上是多副本负载均衡：验证码必须落盘，否则「签发在 A 副本、校验在 B 副本」必然失败
const CAPTCHA_FILE = path.join(__dirname, "data", "captcha.json");

function readCaptchas() {
  try {
    const raw = fs.readFileSync(CAPTCHA_FILE, "utf8");
    const obj = JSON.parse(raw);
    return (obj && typeof obj === "object") ? obj : {};
  } catch (e) { return {}; }
}

function writeCaptchas(obj) {
  writeFileAtomicTo(CAPTCHA_FILE, obj);
}

function issueCaptcha(fixedId) {
  // 算式统一 5 个字符（a+b=? 或 a-b=?），画布宽度固定，识别与排版都好做
  const a = 1 + ((Math.random() * 9) | 0);
  const b = 1 + ((Math.random() * 9) | 0);
  const plus = Math.random() < 0.7;
  let text, answer;
  if (plus) {
    text = a + "+" + b + "=?";
    answer = a + b;
  } else {
    // 减法：保证被减数 > 减数，且结果为正
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);
    text = hi + "-" + lo + "=?";
    answer = hi - lo;
  }
  const id = fixedId || require("crypto").randomBytes(16).toString("hex");
  if (process.env.DEBUG_CAPTCHA === "1") console.log("[captcha] " + text + " -> " + answer);

  // 落盘：所有副本共享，签发与校验才能对上
  const store = readCaptchas();
  store[id] = { answer: answer, exp: Date.now() + CAPTCHA_TTL_MS };
  // 顺手清过期
  const now = Date.now();
  for (const k of Object.keys(store)) {
    if (!store[k] || store[k].exp < now) delete store[k];
  }
  writeCaptchas(store);

  return { id, answer, png: renderCaptcha(text) };
}

/* ---------------- Cloudflare Turnstile ----------------
   服务端校验挂件 token：走 siteverify。
   token 一次性、5 分钟过期；secret 只在服务端，永不下发到浏览器。
------------------------------------------------ */

function verifyTurnstile(token, ip) {
  return new Promise((resolve) => {
    const body = "secret=" + encodeURIComponent(TURNSTILE_SECRET_KEY) +
      "&response=" + encodeURIComponent(token) +
      (ip && ip !== "unknown" ? "&remoteip=" + encodeURIComponent(ip) : "");
    const req = https.request({
      hostname: "challenges.cloudflare.com",
      path: "/turnstile/v0/siteverify",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body)
      },
      timeout: 8000
    }, (res) => {
      let buf = "";
      res.on("data", (d) => { buf += d; });
      res.on("end", () => {
        try {
          const d = JSON.parse(buf || "{}");
          resolve({ ok: !!d.success, errors: d["error-codes"] || [] });
        } catch (e) {
          resolve({ ok: false, errors: ["bad-response"] });
        }
      });
    });
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
    req.on("error", (e) => resolve({ ok: false, errors: ["network:" + e.message] }));
    req.write(body);
    req.end();
  });
}

/* ---------------- 限流 ----------------
   限流表落盘（data/ratelimit.json），不放在内存 Map 里：
   线上网关是多副本负载均衡，内存表各副本互不可见 —— 放在内存里等于没限流。
   文件是所有副本共享的，读改写必须「读→判定→写」一次完成。
   这里全用同步 IO：Node 单线程内同步读改写不会被其他请求插队，
   也就不会出现「两次请求都读到旧表、后写的把先写的覆盖掉」。
------------------------------------------------ */

function readRates() {
  try {
    const raw = fs.readFileSync(RATE_FILE, "utf8");
    const obj = JSON.parse(raw);
    return (obj && typeof obj === "object") ? obj : {};
  } catch (e) { return {}; }
}

function checkRate(ip) {
  const now = Date.now();
  const all = readRates();
  let rec = all[ip];
  if (!rec || typeof rec !== "object") rec = { win: [], hour: [] };
  rec.win = (Array.isArray(rec.win) ? rec.win : []).filter(t => now - t < WINDOW_MS);
  rec.hour = (Array.isArray(rec.hour) ? rec.hour : []).filter(t => now - t < HOUR_MS);

  let verdict = null;
  if (rec.win.length >= WINDOW_MAX) {
    const wait = Math.ceil((WINDOW_MS - (now - rec.win[0])) / 1000);
    verdict = { ok: false, code: 429, wait: Math.max(1, wait), msg: "发得太快了，" + wait + " 秒后再试" };
  } else if (rec.hour.length >= HOUR_MAX) {
    verdict = { ok: false, code: 429, wait: 60, msg: "本小时评论已达上限，稍后再来" };
  } else {
    rec.win.push(now);
    rec.hour.push(now);
  }

  all[ip] = rec;

  // 顺手清掉过期的 IP，避免文件无限膨胀
  for (const k of Object.keys(all)) {
    const r = all[k];
    if (!r || typeof r !== "object") { delete all[k]; continue; }
    const w = (Array.isArray(r.win) ? r.win : []).filter(t => now - t < WINDOW_MS);
    const h = (Array.isArray(r.hour) ? r.hour : []).filter(t => now - t < HOUR_MS);
    if (w.length === 0 && h.length === 0) delete all[k];
    else all[k] = { win: w, hour: h };
  }

  // 同步落盘：返回前表已更新，下一个请求一定看得到
  writeFileAtomicTo(RATE_FILE, all);

  return verdict || { ok: true };
}

/* ---------------- 存储层 ----------------
   纯本地 JSON 文件。写入串行化（Promise 链），落盘用临时文件 + rename 保证原子。
------------------------------------------------ */

let writeChain = Promise.resolve();

function localAll() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function writeFileAtomicTo(file, data) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, "." + path.basename(file) + "." + process.pid + ".tmp");
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, file);   // 同一文件系统内的 rename 是原子操作
}

function writeFileAtomic(arr) {
  writeFileAtomicTo(DATA_FILE, arr);
}

function addComment(comment) {
  // 串行执行：读 → 追加 → 写，避免并发请求读到同一份旧数组
  writeChain = writeChain.then(async () => {
    const arr = localAll();
    // 楼号按「本文评论的创建顺序」固定下来：删掉前面的评论也不会让后面的楼号漂移
    if (!comment.floor) {
      let n = 0;
      for (const c of arr) if (c && c.post === comment.post) n++;
      comment.floor = n + 1;
    }
    arr.push(comment);
    // 只保留最近 2000 条，防止文件无限增长；顺手清掉被裁掉评论的配图
    while (arr.length > 2000) {
      const old = arr.shift();
      if (old && old.image) removeImage(old.image);
    }
    writeFileAtomic(arr);
  });
  return writeChain;
}

async function listComments(postId) {
  return localAll().filter((c) => c.post === postId);
}

/* ---------------- HTTP 服务 ---------------- */

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    let size = 0;
    req.on("data", d => {
      size += d.length;
      if (size > 64 * 1024) { reject(new Error("body too large")); req.destroy(); return; }
      buf += d;
    });
    req.on("end", () => resolve(buf));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path_ = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers": "X-Captcha-Id",
      "Access-Control-Max-Age": "86400"
    });
    res.end();
    return;
  }

  // 健康检查
  if (path_ === "/api/health") {
    json(res, 200, {
      ok: true, storage: "file", count: localAll().length,
      captcha: USE_TURNSTILE ? "turnstile" : "local",
      instance: INSTANCE_ID
    });
    return;
  }

  // 图形验证码
  if (path_ === "/api/captcha" && req.method === "GET") {
    if (USE_TURNSTILE) {
      json(res, 200, { mode: "turnstile", siteKey: TURNSTILE_SITE_KEY });
      return;
    }
    // 客户端可以自带 id：图片 URL 里的 id 与服务端存的答案一一对应，
    // 避免「图片请求」和「取 id 请求」各生成一张不同验证码导致答案对不上。
    let id = clean(url.searchParams.get("id") || "", 64);
    if (!/^[0-9a-f]{16,64}$/.test(id)) {
      id = require("crypto").randomBytes(16).toString("hex");
    }
    const c = issueCaptcha(id);
    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": c.png.length,
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "X-Captcha-Id",
      "X-Captcha-Id": c.id
    });
    res.end(c.png);
    return;
  }

  // 自测辅助：仅 DEBUG_CAPTCHA=1 时可用，返回最近一张未过期验证码的答案
  if (path_ === "/api/_debug/captcha" && req.method === "GET" && process.env.DEBUG_CAPTCHA === "1") {
    const store = readCaptchas();
    let last = null;
    for (const k of Object.keys(store)) last = store[k];
    json(res, 200, { answer: last ? last.answer : null });
    return;
  }

  // 诊断：看服务端实际识别到的客户端 IP（仅 DEBUG_CAPTCHA=1 时可用）
  if (path_ === "/api/_debug/ip" && req.method === "GET" && process.env.DEBUG_CAPTCHA === "1") {
    json(res, 200, {
      ip: clientIp(req),
      xff: req.headers["x-forwarded-for"] || null,
      real: req.headers["x-real-ip"] || null,
      remote: (req.socket && req.socket.remoteAddress) || null,
      instance: INSTANCE_ID
    });
    return;
  }

  // 读取评论
  if (path_ === "/api/comments" && req.method === "GET") {
    const post = clean(url.searchParams.get("post") || "", 60);
    try {
      const list = await listComments(post);
      list.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      json(res, 200, { comments: list.map(publicComment), storage: "file" });
    } catch (e) {
      json(res, 500, { error: "读取评论失败：" + e.message });
    }
    return;
  }

  // 全量导出（备份用）：post=* 返回所有文章的评论 + 配图清单
  if (path_ === "/api/comments/export" && req.method === "GET") {
    try {
      const list = localAll();
      list.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      const images = [];
      for (const c of list) {
        if (c && c.image && images.indexOf(c.image) < 0) images.push(c.image);
      }
      json(res, 200, { comments: list.map(publicComment), count: list.length, images: images, storage: "file" });
    } catch (e) {
      json(res, 500, { error: "导出失败：" + e.message });
    }
    return;
  }

  // 配图输出：文件名严格白名单 + 正则，杜绝路径穿越
  if (path_ === "/api/image" && req.method === "GET") {
    const f = clean(url.searchParams.get("file") || "", 64);
    if (!IMAGE_NAME_RE.test(f)) {
      json(res, 400, { error: "bad file" });
      return;
    }
    let buf;
    try {
      buf = fs.readFileSync(path.join(UPLOAD_DIR, f));
    } catch (e) {
      json(res, 404, { error: "not found" });
      return;
    }
    const ext = f.split(".").pop().toLowerCase();
    const mime = ext === "jpg" ? "image/jpeg" : "image/" + ext;
    res.writeHead(200, {
      "Content-Type": mime,
      "Content-Length": buf.length,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(buf);
    return;
  }

  // 提交评论
  if (path_ === "/api/comments" && req.method === "POST") {
    const ip = clientIp(req);
    let payload;
    try {
      payload = JSON.parse(await readBody(req) || "{}");
    } catch (e) {
      json(res, 400, { error: "请求格式不对" });
      return;
    }

    const post = clean(payload.post || "", 60);
    const nickname = clean(payload.nickname || "匿名", MAX_NICK) || "匿名";
    const content = clean(payload.content || "", MAX_CONTENT);
    const captchaId = clean(payload.captchaId || "", 64);
    const captchaAnswer = clean(payload.captchaAnswer || "", 12);
    // 回复某楼：楼号从 1 开始，0 表示顶层
    let replyTo = parseInt(payload.replyTo, 10);
    if (!isFinite(replyTo) || replyTo < 0) replyTo = 0;
    const replyToNick = clean(payload.replyToNick || "", MAX_NICK);

    if (!post) { json(res, 400, { error: "缺少文章标识" }); return; }
    if (!content) { json(res, 400, { error: "评论内容不能为空" }); return; }
    if (content.length < 2) { json(res, 400, { error: "评论太短了" }); return; }

    // 验证码校验（服务端持有答案）
    if (USE_TURNSTILE) {
      if (!captchaAnswer) {
        json(res, 400, { error: "请先完成人机验证", needCaptcha: true });
        return;
      }
      const vr = await verifyTurnstile(captchaAnswer, ip);
      if (!vr.ok) {
        console.error("[gateway] Turnstile rejected:", vr.errors.join(","));
        json(res, 400, { error: "人机验证未通过，请重试", needCaptcha: true });
        return;
      }
    } else {
      // 一次性：校验并立即作废（从共享文件里删掉）
      const store = readCaptchas();
      const rec = store[captchaId];
      delete store[captchaId];
      writeCaptchas(store);
      if (!rec) { json(res, 400, { error: "验证码已过期，请重新获取", needCaptcha: true }); return; }
      if (rec.exp < Date.now()) { json(res, 400, { error: "验证码已过期，请重新获取", needCaptcha: true }); return; }
      if (String(rec.answer) !== String(captchaAnswer)) {
        json(res, 400, { error: "验证码答案不对", needCaptcha: true });
        return;
      }
    }

    // 限流（验证码过了才计数，避免刷验证码耗配额）
    const rate = checkRate(ip);
    if (!rate.ok) {
      json(res, rate.code, { error: rate.msg, retryAfter: rate.wait }, { "Retry-After": String(rate.wait) });
      return;
    }

    // 配图：先落盘，评论保存失败要把图删掉，避免残留
    const image = saveImage(payload.image || "");

    // 删除码：明文只回给提交者一次，库里只留哈希
    const delKey = require("crypto").randomBytes(6).toString("hex");

    const comment = {
      id: require("crypto").randomBytes(8).toString("hex"),
      post: post,
      nickname: nickname,
      content: content,
      created_at: new Date().toISOString(),
      replyTo: replyTo,
      replyToNick: replyToNick,
      image: image,
      delKeyHash: sha256hex(delKey)
    };
    try {
      await addComment(comment);
      json(res, 200, {
        ok: true,
        comment: publicComment(comment),
        delKey: delKey,
        storage: "file"
      });
    } catch (e) {
      if (image) removeImage(image);
      json(res, 500, { error: "保存失败：" + e.message });
    }
    return;
  }

  // 删除自己的评论：凭删除码（库里只存哈希）
  if (path_ === "/api/comments/delete" && req.method === "POST") {
    const ip = clientIp(req);
    let payload;
    try {
      payload = JSON.parse(await readBody(req) || "{}");
    } catch (e) {
      json(res, 400, { error: "请求格式不对" });
      return;
    }
    const cid = clean(payload.id || "", 32);
    const key = clean(payload.delKey || "", 64);
    if (!cid || !key) { json(res, 400, { error: "缺少评论标识或删除码" }); return; }

    const rate = checkRate(ip);
    if (!rate.ok) {
      json(res, rate.code, { error: rate.msg, retryAfter: rate.wait }, { "Retry-After": String(rate.wait) });
      return;
    }

    const all = localAll();
    let target = null;
    for (const c of all) {
      if (c && c.id === cid) { target = c; break; }
    }
    if (!target) { json(res, 404, { error: "评论不存在或已被删除" }); return; }
    if (!target.delKeyHash || target.delKeyHash !== sha256hex(key)) {
      json(res, 403, { error: "删除码不对" });
      return;
    }
    await deleteCommentById(cid);
    if (target.image) removeImage(target.image);
    json(res, 200, { ok: true, id: cid });
    return;
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("[gateway] listening on 0.0.0.0:" + PORT +
    "  storage=file" +
    "  captcha=" + (USE_TURNSTILE ? "turnstile" : "local"));
});

module.exports = { server };
