/* ============================================================
   pen-pig.github.io — blog.js
   博客：查看（公开）/ 发布（密码解锁编辑模式）
   数据流：assets/data/posts.json（仓库基线）
        + localStorage 本地改动（新增 / 修改 / 删除）
        → 合并渲染；「导出 posts.json」把合并结果写回仓库基线
   ============================================================ */
(function () {
  "use strict";

  /* ---------- 配置 ---------- */
  var DATA_URL = "assets/data/posts.json";
  var LS_KEY = "pen-pig-blog-local-v1";
  var UNLOCK_KEY = "pen-pig-blog-unlocked";
  /* 发布密码只以「盐 + 迭代次数 + 哈希」的形式存在源码里，没有明文。
     算法：H0 = SHA256(salt || password)，再迭代 iterations 次 SHA256(H)
          —— 加盐 + 多轮迭代，把离线爆破的成本抬高 orders 级别。
     改密码：node gateway/hashpass.js "新密码" → 把输出的 JSON 粘到这里。 */
  var BLOG_AUTH = {
    alg: "sha256-iter",
    iterations: 10000,
    salt: "52f6d42b2d4efb5dfd66413a493d1e00",
    hash: "a7a1fe4f843238d81e56f8e525791ffafda06db90adc162edeb7e79abd544eb4"
  };

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

  /* 算密码哈希。两条路径算法完全一致，结果也一致。 */
  function hashPassword(password) {
    var salt = hexToBytes(BLOG_AUTH.salt);
    var pw = utf8Bytes(password);
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
    activeId: null,
    keyword: "",
    loadError: ""
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
    search: $("#blogSearch"),
    unlock: $("#btnUnlock"),
    banner: $("#editBanner"),
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
    edCancel: $("#edCancel")
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
        '<button type="button" class="blog-item' + (p.id === state.activeId ? " on" : "") + '" data-id="' + esc(p.id) + '">' +
        '<span class="blog-item-date">' + esc(p.date) + "</span>" +
        '<span class="blog-item-title">' + esc(p.title) + "</span>" +
        (tags ? '<span class="blog-item-tags">' + tags + "</span>" : "") +
        ops +
        "</button>"
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

  function saveEditor() {
    var title = el.edTitle.value.trim();
    var body = el.edBody.value;
    if (!title) { el.edTitle.focus(); el.edTitle.classList.add("bad"); setTimeout(function () { el.edTitle.classList.remove("bad"); }, 900); return; }
    var post = {
      id: editingId || uid(),
      title: title,
      date: el.edDate.value || today(),
      tags: el.edTags.value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean),
      body: body
    };
    var local = state.local;
    var fromBase = state.posts.some(function (p) { return p.id === post.id && !local.added.some(function (a) { return a.id === post.id; }); });
    if (fromBase) {
      local.edited[post.id] = post;        // 基线文章的改动
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
  }

  function deletePost(id) {
    var p = null;
    state.posts.forEach(function (x) { if (x.id === id) p = x; });
    if (!p) return;
    if (!confirm("删除「" + p.title + "」？\n\n这只删除这台浏览器里的改动；导出 posts.json 并推送后，线上才会生效。")) return;
    var local = state.local;
    local.added = local.added.filter(function (a) { return a.id !== id; });
    delete local.edited[id];
    if (local.deleted.indexOf(id) < 0) local.deleted.push(id);
    saveLocal(local);
    state.local = local;
    state.posts = mergePosts(basePostsCache, local);
    if (state.activeId === id) state.activeId = state.posts.length ? state.posts[0].id : null;
    render();
  }

  /* ---------- 导出 posts.json ---------- */
  function exportPosts() {
    var payload = { posts: state.posts.map(function (p) {
      return { id: p.id, title: p.title, date: p.date, tags: p.tags || [], body: p.body };
    }) };
    var blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "posts.json";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
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
        sessionStorage.removeItem(UNLOCK_KEY);
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
    el.edSave.addEventListener("click", saveEditor);
    el.edCancel.addEventListener("click", closeEditor);
    el.edModal.addEventListener("click", function (e) { if (e.target === el.edModal) closeEditor(); });

    // 工具栏：新建 / 导出
    $("#btnNew").addEventListener("click", function () { openEditor(null); });
    $("#btnExport").addEventListener("click", exportPosts);

    // Esc 关模态
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { closePwModal(); closeEditor(); }
    });

    // hash 变化（前进/后退）
    window.addEventListener("hashchange", function () {
      var id = location.hash.replace(/^#/, "");
      if (id && id !== state.activeId) select(id, false);
    });
  }

  /* ---------- 启动 ---------- */
  var basePostsCache = [];
  function boot() {
    fetch(DATA_URL, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (data) {
      basePostsCache = (data && data.posts) || [];
      state.posts = mergePosts(basePostsCache, state.local);
      var initial = location.hash.replace(/^#/, "");
      state.activeId = (initial && state.posts.some(function (p) { return p.id === initial; }))
        ? initial
        : (state.posts.length ? state.posts[0].id : null);
      bind();
      render();
      mountComments(state.activeId);
    }).catch(function (err) {
      state.loadError = String(err && err.message || err);
      el.list.innerHTML = '<p class="blog-empty">文章数据加载失败：' + esc(state.loadError) + "<br>（通过 file:// 直接打开时浏览器会拦截数据请求，请用本地服务器或线上访问。）</p>";
      el.reader.innerHTML = '<div class="blog-reader-empty"><p>数据没加载上，文章暂时看不了。</p></div>';
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
