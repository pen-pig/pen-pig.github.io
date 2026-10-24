/* ============================================================
   pen-pig.github.io — blog.js
   博客：查看（公开）/ 发布（密码解锁编辑模式）
   数据流：网关 GET /api/posts（线上的正式文章）
        → 网关不可用时回退到 assets/data/posts.json（仓库里的快照）
        + localStorage 草稿（还没发布的改动）
   发布：解锁时用密码向网关换一个临时令牌，
        「发布上线」= 验证码 + 令牌 → 网关写回文章库，所有访客立刻可见
   ============================================================ */
(function () {
  "use strict";

  /* ---------- 配置 ---------- */
  var DATA_URL = "assets/data/posts.json";
  var LS_KEY = "pen-pig-blog-local-v1";
  var UNLOCK_KEY = "pen-pig-blog-unlocked";
  var TOKEN_KEY = "pen-pig-blog-token";

  /* 发布密码只以「盐 + 迭代次数 + 哈希」的形式存在源码里，没有明文。
     算法：H0 = SHA256(salt || password)，再迭代 iterations 次 SHA256(H)。
     改密码：node gateway/hashpass.js "新密码" → 把输出的 JSON 粘到这里，
     同时粘到 gateway/server.js 的 PUBLISH_AUTH（网关要自己校验一遍）。 */
  var BLOG_AUTH = {
    alg: "sha256-iter",
    iterations: 10000,
    salt: "52f6d42b2d4efb5dfd66413a493d1e00",
    hash: "a7a1fe4f843238d81e56f8e525791ffafda06db90adc162edeb7e79abd544eb4"
  };

  /* 网关地址：线上是独立域名，与 GitHub Pages 不同源（走 CORS）。
     "?local=1" 强制走本地网关（联调用），"?gw=8799" 指定本地端口。 */
  var LOCAL_GATEWAY = "http://127.0.0.1:" + ((location.search.match(/[?&]gw=(\d+)/) || [])[1] || "8791");
  var SHARE_CODE = "OBVHYSCDUX";
  var GATEWAY = (location.search.indexOf("local=1") >= 0)
    ? LOCAL_GATEWAY
    : "https://pen-pig-comment-gateway.app.workbuddy.host";

  function api(path) {
    if (GATEWAY === LOCAL_GATEWAY) return GATEWAY + path;
    return GATEWAY + path + "?sharecode=" + encodeURIComponent(SHARE_CODE);
  }

  /* 拼接带额外参数的接口地址：避免出现两个 ? 把 sharecode 参数弄坏 */
  function apiQ(path, params) {
    var base = api(path);
    var qs = [];
    for (var k in params) {
      if (Object.prototype.hasOwnProperty.call(params, k)) {
        qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
      }
    }
    if (!qs.length) return base;
    return base + (base.indexOf("?") >= 0 ? "&" : "?") + qs.join("&");
  }

  /* ---------- 工具 ---------- */
  function $(s, c) { return (c || document).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function today() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }
  function uid() {
    return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ---------- 密码哈希 ---------- */
  function hexToBytes(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  function utf8Bytes(str) {
    if (window.TextEncoder) return new TextEncoder().encode(str);
    var esc = unescape(encodeURIComponent(str));
    var out = new Uint8Array(esc.length);
    for (var i = 0; i < esc.length; i++) out[i] = esc.charCodeAt(i);
    return out;
  }
  function concatBytes(a, b) {
    var out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }
  function bytesToHex(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) {
      var h = bytes[i].toString(16);
      s += h.length === 1 ? "0" + h : h;
    }
    return s;
  }

  /* 纯 JS SHA-256：只在页面不在安全上下文（没有 crypto.subtle）时兜底用 */
  var SHA_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  function sha256Sync(bytes) {
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    var len = bytes.length;
    var bitLenHi = Math.floor(len / 536870912);
    var bitLenLo = (len << 3) >>> 0;
    var withPad = len + 1;
    while (withPad % 64 !== 56) withPad++;
    var total = withPad + 8;

    var buf = new Uint8Array(total);
    buf.set(bytes, 0);
    buf[len] = 0x80;
    var dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, bitLenHi, false);
    dv.setUint32(total - 4, bitLenLo, false);

    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
             0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Int32Array(64);
    var i, off;

    for (off = 0; off < total; off += 64) {
      for (i = 0; i < 16; i++) w[i] = dv.getInt32(off + i * 4, false);
      for (i = 16; i < 64; i++) {
        var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3];
      var e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + SHA_K[i] + w[i]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }

    var out = new Uint8Array(32);
    var odv = new DataView(out.buffer);
    for (var j = 0; j < 8; j++) odv.setUint32(j * 4, H[j] >>> 0, false);
    return out;
  }

  /* 密码归一化：中文输入法会把 ! # ~ 之类打成全角，直接算哈希必然对不上。
     这里统一把全角 ASCII 转成半角，并去掉首尾空白。
     网关的 checkPublishPassword 用同一套规则，两边结果必须一致。 */
  function normalizePassword(pw) {
    var s = String(pw == null ? "" : pw);
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      // 全角 ASCII（！＂＃…～）→ 半角
      if (code >= 0xff01 && code <= 0xff5e) out += String.fromCharCode(code - 0xfee0);
      // 全角空格 → 半角空格
      else if (code === 0x3000) out += " ";
      else out += s.charAt(i);
    }
    return out.replace(/^\s+|\s+$/g, "");
  }

  /* 算密码哈希。两条路径算法完全一致，结果也一致。 */
  function hashPassword(password) {
    var salt = hexToBytes(BLOG_AUTH.salt);
    var pw = utf8Bytes(normalizePassword(password));
    var iters = BLOG_AUTH.iterations;
    var subtle = window.crypto && window.crypto.subtle;

    if (subtle) {
      return subtle.digest("SHA-256", concatBytes(salt, pw)).then(function (buf) {
        // 链首必须是初始哈希：Promise.resolve() 会解析成 undefined
        var chain = Promise.resolve(new Uint8Array(buf));
        for (var i = 0; i < iters; i++) {
          chain = chain.then(function (cur) {
            return subtle.digest("SHA-256", cur).then(function (b) { return new Uint8Array(b); });
          });
        }
        return chain.then(function (last) { return bytesToHex(last); });
      });
    }

    // 降级路径：同步迭代，没有 subtle 时页面不是安全上下文
    var h2 = sha256Sync(concatBytes(salt, pw));
    for (var j = 0; j < iters; j++) h2 = sha256Sync(h2);
    return Promise.resolve(bytesToHex(h2));
  }

  /* 常数时间比较：不因前缀相同而提前返回 */
  function safeEqual(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    if (a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  /* ---------- 本地改动层 ---------- */
  function loadLocal() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return { added: [], edited: {}, deleted: [] };
      var d = JSON.parse(raw);
      return {
        added: Array.isArray(d.added) ? d.added : [],
        edited: d.edited && typeof d.edited === "object" ? d.edited : {},
        deleted: Array.isArray(d.deleted) ? d.deleted : []
      };
    } catch (e) { return { added: [], edited: {}, deleted: [] }; }
  }
  function saveLocal(local) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(local)); } catch (e) { /* 隐私模式等场景下降级为仅内存 */ }
  }

  /* 仓库基线 + 本地改动 → 最终文章列表（新→旧） */
  function mergePosts(basePosts, local) {
    var byId = {};
    basePosts.forEach(function (p) { byId[p.id] = p; });
    Object.keys(local.edited).forEach(function (id) {
      if (byId[id]) byId[id] = local.edited[id];
    });
    local.deleted.forEach(function (id) { delete byId[id]; });
    var all = Object.keys(byId).map(function (k) { return byId[k]; });
    local.added.forEach(function (p) { all.push(p); });
    all.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    return all;
  }

  /* ---------- 状态 ---------- */
  var state = {
    posts: [],        // 合并后的文章
    local: loadLocal(),
    unlocked: sessionStorage.getItem(UNLOCK_KEY) === "1",
    token: sessionStorage.getItem(TOKEN_KEY) || "",   // 网关签发的发布令牌
    activeId: null,
    keyword: "",
    loadError: "",
    source: ""        // 文章来自哪儿："gateway" = 网关，"static" = 仓库快照
  };

  /* ---------- 迷你 markdown 渲染（先转义，后排版；XSS 安全） ---------- */
  function renderMarkdown(src) {
    var text = String(src == null ? "" : src).replace(/\r\n?/g, "\n");
    var codeBlocks = [];
    // 1. 抽出代码块，占位保护
    text = text.replace(/```(\w*)\n([\s\S]*?)```/g, function (_, lang, code) {
      codeBlocks.push('<pre class="md-pre"><code>' + esc(code.replace(/\n$/, "")) + "</code></pre>");
      return "\u0001" + (codeBlocks.length - 1) + "\u0001";
    });
    // 2. 行级排版
    var lines = text.split("\n");
    var html = [];
    var inUL = false, inOL = false, inQuote = false;
    function closeBlocks() {
      if (inUL) { html.push("</ul>"); inUL = false; }
      if (inOL) { html.push("</ol>"); inOL = false; }
      if (inQuote) { html.push("</blockquote>"); inQuote = false; }
    }
    lines.forEach(function (raw) {
      var line = esc(raw.trim());
      var m;
      if ((m = line.match(/^\u0001(\d+)\u0001$/))) { closeBlocks(); html.push(codeBlocks[+m[1]]); return; }
      if (/^---+$/.test(line)) { closeBlocks(); html.push('<hr class="md-hr">'); return; }
      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
        closeBlocks();
        var lv = m[1].length;
        html.push("<h" + lv + ' class="md-h md-h' + lv + '">' + inline(m[2]) + "</h" + lv + ">");
        return;
      }
      if ((m = line.match(/^>\s?(.*)$/))) {
        if (!inQuote) { closeBlocks(); html.push('<blockquote class="md-quote">'); inQuote = true; }
        html.push("<p>" + inline(m[1]) + "</p>");
        return;
      }
      if ((m = line.match(/^[-*]\s+(.*)$/))) {
        if (!inUL) { closeBlocks(); html.push('<ul class="md-ul">'); inUL = true; }
        html.push("<li>" + inline(m[1]) + "</li>");
        return;
      }
      if ((m = line.match(/^\d+[.、]\s*(.*)$/))) {
        if (!inOL) { closeBlocks(); html.push('<ol class="md-ol">'); inOL = true; }
        html.push("<li>" + inline(m[1]) + "</li>");
        return;
      }
      if (line === "") { closeBlocks(); return; }
      closeBlocks();
      html.push("<p>" + inline(line) + "</p>");
    });
    closeBlocks();
    return html.join("\n");

    // 3. 行内语法（内容已转义）
    function inline(s) {
      return s
        .replace(/`([^`]+)`/g, function (_, c) { return '<code class="md-code">' + c + "</code>"; })
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, t, u) {
          var href = /^https?:\/\//i.test(u) ? u : (u.charAt(0) === "/" ? u : "");
          if (!href) return t;
          var ext = /^https?:/i.test(href);
          return '<a class="md-a" href="' + href + '"' + (ext ? ' target="_blank" rel="noopener noreferrer"' : "") + ">" + t + "</a>";
        });
    }
  }

  /* ---------- DOM 引用 ---------- */
  var el = {
    count: $("#blogCount"),
    status: $("#blogStatus"),
    search: $("#blogSearch"),
    unlock: $("#btnUnlock"),
    banner: $("#editBanner"),
    editTools: $("#editTools"),
    list: $("#blogList"),
    reader: $("#blogReader"),
    pwModal: $("#pwModal"),
    pwInput: $("#pwInput"),
    pwError: $("#pwError"),
    edModal: $("#editorModal"),
    edTitle: $("#edTitle"),
    edDate: $("#edDate"),
    edTags: $("#edTags"),
    edBody: $("#edBody"),
    edHeading: $("#edHeading"),
    edSave: $("#edSave"),
    edPublish: $("#edPublish"),
    edCancel: $("#edCancel"),
    pubModal: $("#publishModal"),
    pubHeading: $("#pubHeading"),
    pubDesc: $("#pubDesc"),
    pubImg: $("#pubCaptcha"),
    pubAnswer: $("#pubAnswer"),
    pubReload: $("#pubReload"),
    pubPwField: $("#pubPwField"),
    pubPassword: $("#pubPassword"),
    pubError: $("#pubError"),
    pubConfirm: $("#pubConfirm"),
    pubCancel: $("#pubCancel")
  };

  /* ---------- 渲染：列表 ---------- */
  function visiblePosts() {
    var kw = state.keyword.trim().toLowerCase();
    if (!kw) return state.posts;
    return state.posts.filter(function (p) {
      var hay = (p.title + " " + (p.tags || []).join(" ") + " " + p.body).toLowerCase();
      return hay.indexOf(kw) >= 0;
    });
  }

  function renderList() {
    var posts = visiblePosts();
    el.count.textContent = state.posts.length + " 篇" + (state.keyword ? " · 命中 " + posts.length + " 篇" : "");

    if (!posts.length) {
      el.list.innerHTML = '<p class="blog-empty">' + (state.keyword ? "没有匹配的文章。" : "还没有文章。") + "</p>";
      return;
    }
    var html = posts.map(function (p) {
      var tags = (p.tags || []).map(function (t) { return "#" + esc(t); }).join(" ");
      var ops = state.unlocked
        ? '<span class="blog-item-ops">' +
          '<button type="button" class="blog-op" data-act="edit" data-id="' + esc(p.id) + '" title="编辑">✎</button>' +
          '<button type="button" class="blog-op blog-op-del" data-act="del" data-id="' + esc(p.id) + '" title="删除">✕</button>' +
          "</span>"
        : "";
      return (
        // 用 div 而不是 button：里面还要放「编辑 / 删除」两个按钮，
        // button 套 button 会被 HTML 解析器提前闭合，外层按钮里的内容全丢
        '<div class="blog-item' + (p.id === state.activeId ? " on" : "") + '" data-id="' + esc(p.id) + '" role="button" tabindex="0">' +
        '<span class="blog-item-date">' + esc(p.date) + "</span>" +
        '<span class="blog-item-title">' + esc(p.title) + "</span>" +
        (tags ? '<span class="blog-item-tags">' + tags + "</span>" : "") +
        ops +
        "</div>"
      );
    }).join("");
    el.list.innerHTML = html;
  }

  /* ---------- 渲染：阅读区 ---------- */
  function renderReader() {
    var p = null;
    state.posts.forEach(function (x) { if (x.id === state.activeId) p = x; });
    if (!p) {
      el.reader.innerHTML =
        '<div class="blog-reader-empty">' +
        '<p class="blog-reader-empty-kicker">// NO SELECTION</p>' +
        "<p>从左边选一篇文章开始读。" + (state.unlocked ? "或者点上方「＋ 新建文章」写一篇。" : "") + "</p>" +
        "</div>";
      return;
    }
    var chars = String(p.body || "").length;
    el.reader.innerHTML =
      '<header class="blog-reader-head">' +
      '<p class="blog-reader-kicker">' + esc(p.date) + (state.unlocked ? ' · <button type="button" class="blog-op" data-act="edit" data-id="' + esc(p.id) + '">✎ 编辑此篇</button>' : "") + "</p>" +
      "<h2>" + esc(p.title) + "</h2>" +
      '<p class="blog-reader-meta">' +
      (p.tags || []).map(function (t) { return "<span>#" + esc(t) + "</span>"; }).join("") +
      "<i>" + chars + " 字</i>" +
      "</p>" +
      "</header>" +
      '<div class="blog-reader-body md">' + renderMarkdown(p.body) + "</div>";
  }

  function render() {
    renderList();
    renderReader();
    if (el.unlock) {
      el.unlock.textContent = state.unlocked ? "🔒 锁定编辑" : "🔓 解锁编辑";
      el.unlock.classList.toggle("btn-primary", state.unlocked);
      el.unlock.classList.toggle("btn-ghost", !state.unlocked);
    }
    if (el.banner) el.banner.hidden = !state.unlocked;
    if (el.editTools) el.editTools.hidden = !state.unlocked;
  }

  /* ---------- 选择文章（hash 深链） ---------- */
  function select(id, push) {
    state.activeId = id;
    if (push && location.hash !== "#" + id) location.hash = id;
    render();
    mountComments(id);
  }

  /* ---------- 评论区 ---------- */
  function mountComments(postId) {
    if (!window.BlogComments || !postId) return;
    // 评论按文章 id 归属；切文章时重新拉取该文的评论
    window.BlogComments.mount(postId);
  }

  /* ---------- 密码 ---------- */
  function openPwModal() {
    el.pwModal.hidden = false;
    el.pwInput.value = "";
    el.pwError.hidden = true;
    el.pwError.textContent = "密码不对，再试试。";
    setTimeout(function () { el.pwInput.focus(); }, 30);
  }
  function closePwModal() { el.pwModal.hidden = true; }

  /* 用密码向网关换一个发布令牌：拿到之后发布/删除都不用再输密码。
     网关不可达时不报错，只是发布时再要一次密码。 */
  function requestToken(pw) {
    return fetch(api("/api/publish/token"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (res) {
        if (res.ok && res.data && res.data.token) {
          state.token = res.data.token;
          try { sessionStorage.setItem(TOKEN_KEY, state.token); } catch (e) {}
        }
      })
      .catch(function () { /* 网关暂时不可达：发布时再问密码 */ });
  }

  function tryUnlock() {
    var pw = el.pwInput.value;
    if (!pw) { el.pwError.hidden = false; return; }

    var btn = document.getElementById("pwConfirm");
    var oldText = btn ? btn.textContent : "解锁";
    if (btn) { btn.disabled = true; btn.textContent = "校验中…"; }
    el.pwError.hidden = true;

    hashPassword(pw).then(function (got) {
      if (safeEqual(got, BLOG_AUTH.hash)) {
        state.unlocked = true;
        sessionStorage.setItem(UNLOCK_KEY, "1");
        closePwModal();
        render();
        requestToken(pw);
        return;
      }
      el.pwError.hidden = false;
      el.pwInput.value = "";
      el.pwInput.focus();
    }).catch(function (err) {
      el.pwError.hidden = false;
      el.pwError.textContent = "校验失败：" + String((err && err.message) || err);
    }).then(function () {
      if (btn) { btn.disabled = false; btn.textContent = oldText; }
    });
  }

  /* ---------- 编辑器 ---------- */
  var editingId = null; // null = 新建
  function openEditor(post) {
    editingId = post ? post.id : null;
    el.edHeading.textContent = post ? "编辑文章" : "新建文章";
    el.edTitle.value = post ? post.title : "";
    el.edDate.value = post ? post.date : today();
    el.edTags.value = post ? (post.tags || []).join(", ") : "";
    el.edBody.value = post ? post.body : "";
    el.edModal.hidden = false;
    setTimeout(function () { el.edTitle.focus(); }, 30);
  }
  function closeEditor() { el.edModal.hidden = true; editingId = null; }

  // 从表单收集一篇文章
  function collectPost() {
    var title = el.edTitle.value.trim();
    if (!title) {
      el.edTitle.focus();
      el.edTitle.classList.add("bad");
      setTimeout(function () { el.edTitle.classList.remove("bad"); }, 900);
      return null;
    }
    return {
      id: editingId || uid(),
      title: title,
      date: el.edDate.value || today(),
      tags: el.edTags.value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean),
      body: el.edBody.value
    };
  }

  // 存草稿：只写这台浏览器的 localStorage，不上线
  function saveDraft() {
    var post = collectPost();
    if (!post) return;
    var local = state.local;
    var inBase = basePostsCache.some(function (p) { return p.id === post.id; });
    if (inBase) {
      local.edited[post.id] = post;
    } else {
      var existed = false;
      local.added = local.added.map(function (a) { if (a.id === post.id) { existed = true; return post; } return a; });
      if (!existed) local.added.push(post);
    }
    local.deleted = local.deleted.filter(function (id) { return id !== post.id; });
    saveLocal(local);
    state.local = local;
    state.posts = mergePosts(basePostsCache, local);
    closeEditor();
    select(post.id, true);
    flash("草稿存在这台浏览器里，点「发布上线」才推给所有访客");
  }

  // 发布成功后，这篇文章的本地草稿就没用了
  function clearLocalDraft(id) {
    var local = state.local;
    local.added = local.added.filter(function (a) { return a.id !== id; });
    delete local.edited[id];
    local.deleted = local.deleted.filter(function (x) { return x !== id; });
    saveLocal(local);
    state.local = local;
  }

  function deletePost(id) {
    var p = null;
    state.posts.forEach(function (x) { if (x.id === id) p = x; });
    if (!p) return;
    if (!confirm("删除「" + p.title + "」？\n\n确认后还要过一次人机验证，删除后所有访客都看不到了。")) return;
    openPublish("delete", p);
  }

  /* ---------- 发布确认 ---------- */
  var pubMode = "publish";     // publish | delete
  var pendingPost = null;
  var pubBusy = false;

  function openPublish(mode, post) {
    pubMode = mode;
    pendingPost = post;
    el.pubHeading.textContent = mode === "delete" ? "确认删除" : "发布上线";
    el.pubDesc.textContent = mode === "delete"
      ? "「" + post.title + "」会从线上消失，所有访客立刻看不到。"
      : "「" + post.title + "」发布后所有访客立刻能看到。";
    el.pubConfirm.textContent = mode === "delete" ? "确认删除" : "确认发布";
    el.pubError.hidden = true;
    el.pubError.textContent = "";
    // 解锁时换到过令牌就不用再输密码
    el.pubPwField.hidden = !!state.token;
    if (el.pubPassword) el.pubPassword.value = "";
    el.pubModal.hidden = false;
    loadPubCaptcha();
    setTimeout(function () { el.pubAnswer.focus(); }, 30);
  }

  function closePublish() {
    el.pubModal.hidden = true;
    pendingPost = null;
    pubBusy = false;
  }

  function loadPubCaptcha() {
    var id = "";
    try {
      var buf = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(buf);
      id = Array.prototype.map.call(buf, function (b) {
        return ("0" + b.toString(16)).slice(-2);
      }).join("");
    } catch (e) {
      for (var i = 0; i < 4; i++) id += Math.floor(Math.random() * 0xffffffff).toString(16);
      id = id.slice(0, 32);
    }
    state.pubCaptchaId = id;
    el.pubImg.crossOrigin = "anonymous";
    el.pubImg.src = apiQ("/api/captcha", { id: id, t: Date.now() });
    if (el.pubAnswer) el.pubAnswer.value = "";
  }

  function showPubError(msg) {
    el.pubError.hidden = false;
    el.pubError.textContent = msg;
  }

  function confirmPublish() {
    if (pubBusy || !pendingPost) return;
    var answer = el.pubAnswer.value.trim();
    if (!answer) { showPubError("请填写验证码答案"); el.pubAnswer.focus(); return; }

    var body = { captchaId: state.pubCaptchaId, captchaAnswer: answer };
    if (state.token) {
      body.token = state.token;
    } else {
      var pw = el.pubPassword.value;
      if (!pw) { showPubError("请填写发布密码"); el.pubPassword.focus(); return; }
      body.password = pw;
    }
    if (pubMode === "publish") body.post = pendingPost;
    else body.id = pendingPost.id;

    var mode = pubMode;
    var postId = pendingPost.id;
    pubBusy = true;
    el.pubConfirm.disabled = true;
    el.pubError.hidden = true;

    fetch(api(mode === "publish" ? "/api/posts" : "/api/posts/delete"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
      .then(function (r) {
        return r.json().then(function (d) { return { status: r.status, data: d }; });
      })
      .then(function (res) {
        if (res.status === 200 && res.data && res.data.ok) {
          if (Array.isArray(res.data.posts)) {
            basePostsCache = res.data.posts;
            state.source = "gateway";
          }
          clearLocalDraft(postId);
          state.posts = mergePosts(basePostsCache, state.local);
          closePublish();
          closeEditor();
          if (!state.posts.some(function (p) { return p.id === state.activeId; })) {
            state.activeId = state.posts.length ? state.posts[0].id : null;
          }
          select(state.activeId, false);
          flash(mode === "publish" ? "已发布，所有访客都能看到了" : "已删除");
          return;
        }
        var msg = (res.data && res.data.error) || "操作失败";
        showPubError(msg);
        loadPubCaptcha();
      })
      .catch(function () {
        showPubError("网络错误，稍后再试");
        loadPubCaptcha();
      })
      .then(function () {
        pubBusy = false;
        el.pubConfirm.disabled = false;
      });
  }

  /* 顶部状态条 */
  var flashTimer = null;
  function flash(msg) {
    if (!el.status) return;
    el.status.textContent = msg;
    el.status.classList.add("on");
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      flashTimer = null;
      el.status.classList.remove("on");
    }, 4500);
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    // 列表点击 / 编辑 / 删除
    el.list.addEventListener("click", function (e) {
      var op = e.target.closest(".blog-op");
      if (op) {
        e.stopPropagation();
        if (op.getAttribute("data-act") === "edit") {
          var p = null;
          state.posts.forEach(function (x) { if (x.id === op.getAttribute("data-id")) p = x; });
          if (p) openEditor(p);
        } else {
          deletePost(op.getAttribute("data-id"));
        }
        return;
      }
      var item = e.target.closest(".blog-item");
      if (item) select(item.getAttribute("data-id"), true);
    });

    // 列表键盘操作（列表项现在是 div，得自己处理回车 / 空格）
    el.list.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target.closest(".blog-op")) return;
      var item = e.target.closest(".blog-item");
      if (!item) return;
      e.preventDefault();
      select(item.getAttribute("data-id"), true);
    });

    // 阅读区里的「编辑此篇」
    el.reader.addEventListener("click", function (e) {
      var op = e.target.closest('[data-act="edit"]');
      if (!op) return;
      var p = null;
      state.posts.forEach(function (x) { if (x.id === op.getAttribute("data-id")) p = x; });
      if (p) openEditor(p);
    });

    // 搜索
    el.search.addEventListener("input", function () {
      state.keyword = el.search.value;
      renderList();
    });

    // 解锁 / 锁定
    el.unlock.addEventListener("click", function () {
      if (state.unlocked) {
        state.unlocked = false;
        state.token = "";
        try { sessionStorage.removeItem(UNLOCK_KEY); sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
        render();
      } else {
        openPwModal();
      }
    });

    // 密码模态
    $("#pwConfirm").addEventListener("click", tryUnlock);
    $("#pwCancel").addEventListener("click", closePwModal);
    el.pwInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); tryUnlock(); }
    });
    el.pwModal.addEventListener("click", function (e) { if (e.target === el.pwModal) closePwModal(); });

    // 编辑模态
    el.edSave.addEventListener("click", saveDraft);
    el.edPublish.addEventListener("click", function () {
      var post = collectPost();
      if (!post) return;
      openPublish("publish", post);
    });
    el.edCancel.addEventListener("click", closeEditor);
    el.edModal.addEventListener("click", function (e) { if (e.target === el.edModal) closeEditor(); });

    // 发布确认模态
    el.pubCancel.addEventListener("click", closePublish);
    el.pubConfirm.addEventListener("click", confirmPublish);
    el.pubModal.addEventListener("click", function (e) { if (e.target === el.pubModal) closePublish(); });
    el.pubReload.addEventListener("click", function () { loadPubCaptcha(); el.pubAnswer.focus(); });
    el.pubImg.addEventListener("click", function () { loadPubCaptcha(); });
    el.pubAnswer.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); confirmPublish(); }
    });

    // 工具栏：新建
    $("#btnNew").addEventListener("click", function () { openEditor(null); });

    // Esc 关模态
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { closePwModal(); closeEditor(); closePublish(); }
    });

    // hash 变化（前进/后退）
    window.addEventListener("hashchange", function () {
      var id = location.hash.replace(/^#/, "");
      if (id && id !== state.activeId) select(id, false);
    });
  }

  /* ---------- 启动 ---------- */
  var basePostsCache = [];

  // 线上正式文章：网关的文章库
  function fetchGatewayPosts() {
    return fetch(apiQ("/api/posts", { t: Date.now() }), { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (d) {
        if (!d || !Array.isArray(d.posts) || !d.posts.length) throw new Error("empty");
        return d.posts;
      });
  }

  // 网关不可用时的退路：仓库里的快照
  function fetchStaticPosts() {
    return fetch(DATA_URL, { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) { return (data && data.posts) || []; });
  }

  function boot() {
    fetchGatewayPosts()
      .then(function (posts) {
        basePostsCache = posts;
        state.source = "gateway";
      })
      .catch(function () {
        return fetchStaticPosts().then(function (posts) {
          basePostsCache = posts;
          state.source = "static";
        });
      })
      .then(function () {
        state.posts = mergePosts(basePostsCache, state.local);
        var initial = location.hash.replace(/^#/, "");
        state.activeId = (initial && state.posts.some(function (p) { return p.id === initial; }))
          ? initial
          : (state.posts.length ? state.posts[0].id : null);
        bind();
        render();
        mountComments(state.activeId);
      })
      .catch(function (err) {
        state.loadError = String(err && err.message || err);
        el.list.innerHTML = '<p class="blog-empty">文章数据加载失败：' + esc(state.loadError) + "<br>（网关和仓库快照都没读到。检查一下网络，或用本地服务器打开。）</p>";
        el.reader.innerHTML = '<div class="blog-reader-empty"><p>数据没加载上，文章暂时看不了。</p></div>';
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
