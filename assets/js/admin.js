/* ============================================================
   pen-pig.github.io — admin.js
   统一后台：解锁 + 站点文案 + 文章 + 评论 + 密码。

   鉴权：和博客同一套 —— 用密码向网关换一个 2 小时临时令牌，
   之后所有后台操作都带令牌。改密码后网关会重新算哈希，
   所以前端永远从 GET /api/publish/auth 拿「当前生效」的盐+哈希，
   不再死用源码里那份常量。

   安全：发布/删除文章、改密码都还要过一道验证码（和博客一致），
   丢令牌也不能刷屏。
   ============================================================ */
(function () {
  "use strict";

  /* ---------- 配置 ---------- */
  var DATA_URL = "assets/data/posts.json";
  var DRAFTS_KEY = "pen-pig-admin-drafts-v1";
  var UNLOCK_KEY = "pen-pig-admin-unlocked";
  var TOKEN_KEY = "pen-pig-admin-token";

  /* 发布密码只以「盐 + 迭代次数 + 哈希」的形式存在源码里，没有明文。
     但改过密码后这份就不是最新的了 —— 前端解锁前会先去网关拉当前值。 */
  var BLOG_AUTH = {
    alg: "sha256-iter",
    iterations: 10000,
    salt: "52f6d42b2d4efb5dfd66413a493d1e00",
    hash: "a7a1fe4f843238d81e56f8e525791ffafda06db90adc162edeb7e79abd544eb4"
  };

  /* 网关地址：线上是独立域名，与 GitHub Pages 不同源（走 CORS）。
     "?local=1" 强制走本地网关，"?gw=8799" 指定本地端口（联调用）。 */
  var LOCAL_GATEWAY = "http://127.0.0.1:" + ((location.search.match(/[?&]gw=(\d+)/) || [])[1] || "8791");
  var SHARE_CODE = "OBVHYSCDUX";
  var GATEWAY = (location.search.indexOf("local=1") >= 0)
    ? LOCAL_GATEWAY
    : "https://pen-pig-comment-gateway.app.workbuddy.host";

  function api(path) {
    if (GATEWAY === LOCAL_GATEWAY) return GATEWAY + path;
    return GATEWAY + path + "?sharecode=" + encodeURIComponent(SHARE_CODE);
  }
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
  function captchaUrl(id) {
    var base = api("/api/captcha");
    return base + (base.indexOf("?") >= 0 ? "&" : "?") + "id=" + encodeURIComponent(id);
  }
  // 验证码 id 必须是 16~64 位十六进制（网关强制校验）；uid() 以 "p" 开头不合法，
  // 会导致服务端改用随机 id、校验时找不到答案而报「已过期」。这里用纯 hex。
  function capId() {
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
    return id;
  }

  /* ---------- 工具 ---------- */
  function $(s, c) { return (c || document).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function clean(s, n) { var t = String(s == null ? "" : s).trim(); return n ? t.slice(0, n) : t; }
  function today() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }
  function uid() { return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function setStatus(elId, msg, kind) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.textContent = msg || "";
    el.className = "status-line" + (kind ? " " + kind : "");
  }

  /* ---------- 密码哈希 ---------- */
  function normalizePassword(pw) {
    var s = String(pw == null ? "" : pw);
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      if (code >= 0xff01 && code <= 0xff5e) out += String.fromCharCode(code - 0xfee0);
      else if (code === 0x3000) out += " ";
      else out += s.charAt(i);
    }
    return out.replace(/^\s+|\s+$/g, "");
  }
  function hexToBytes(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  function utf8Bytes(str) {
    if (window.TextEncoder) return new TextEncoder().encode(str);
    var e = unescape(encodeURIComponent(str));
    var out = new Uint8Array(e.length);
    for (var i = 0; i < e.length; i++) out[i] = e.charCodeAt(i);
    return out;
  }
  function concatBytes(a, b) {
    var out = new Uint8Array(a.length + b.length);
    out.set(a, 0); out.set(b, a.length);
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
  function sha256Sync(bytes) {
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    var SHA_K = [
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    var len = bytes.length;
    var bitLenHi = Math.floor(len / 536870912), bitLenLo = (len << 3) >>> 0;
    var withPad = len + 1; while (withPad % 64 !== 56) withPad++;
    var total = withPad + 8;
    var buf = new Uint8Array(total); buf.set(bytes, 0); buf[len] = 0x80;
    var dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, bitLenHi, false); dv.setUint32(total - 4, bitLenLo, false);
    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var w = new Int32Array(64), i, off;
    for (off = 0; off < total; off += 64) {
      for (i = 0; i < 16; i++) w[i] = dv.getInt32(off + i * 4, false);
      for (i = 16; i < 64; i++) {
        var s0 = rotr(w[i-15],7) ^ rotr(w[i-15],18) ^ (w[i-15] >>> 3);
        var s1 = rotr(w[i-2],17) ^ rotr(w[i-2],19) ^ (w[i-2] >>> 10);
        w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0;
      }
      var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
      for (i = 0; i < 64; i++) {
        var S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + SHA_K[i] + w[i]) | 0;
        var S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;
      }
      H[0]=(H[0]+a)|0;H[1]=(H[1]+b)|0;H[2]=(H[2]+c)|0;H[3]=(H[3]+d)|0;
      H[4]=(H[4]+e)|0;H[5]=(H[5]+f)|0;H[6]=(H[6]+g)|0;H[7]=(H[7]+h)|0;
    }
    var out = new Uint8Array(32), odv = new DataView(out.buffer);
    for (var j = 0; j < 8; j++) odv.setUint32(j*4, H[j] >>> 0, false);
    return out;
  }
  function hashPassword(password, auth) {
    var salt = hexToBytes(auth.salt);
    var pw = utf8Bytes(normalizePassword(password));
    var iters = auth.iterations;
    var subtle = window.crypto && window.crypto.subtle;
    if (subtle) {
      return subtle.digest("SHA-256", concatBytes(salt, pw)).then(function (buf) {
        var chain = Promise.resolve(new Uint8Array(buf));
        for (var i = 0; i < iters; i++) {
          chain = chain.then(function (cur) {
            return subtle.digest("SHA-256", cur).then(function (b) { return new Uint8Array(b); });
          });
        }
        return chain.then(function (last) { return bytesToHex(last); });
      });
    }
    var h2 = sha256Sync(concatBytes(salt, pw));
    for (var j = 0; j < iters; j++) h2 = sha256Sync(h2);
    return Promise.resolve(bytesToHex(h2));
  }
  function safeEqual(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    if (a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

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
    var html = [], inUL = false, inOL = false, inQuote = false;
    function closeBlocks() {
      if (inUL) { html.push("</ul>"); inUL = false; }
      if (inOL) { html.push("</ol>"); inOL = false; }
      if (inQuote) { html.push("</blockquote>"); inQuote = false; }
    }
    lines.forEach(function (raw) {
      var line = esc(raw.trim());
      var m;
      if ((m = line.match(/^\u0001(\d+)\u0001$/))) { closeBlocks(); html.push(codeBlocks[+m[1]] || ""); return; }
      if (/^---+$/.test(line)) { closeBlocks(); html.push('<hr class="md-hr">'); return; }
      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
        closeBlocks(); var lv = m[1].length;
        html.push("<h" + lv + ' class="md-h md-h' + lv + '">' + inline(m[2]) + "</h" + lv + ">"); return;
      }
      if ((m = line.match(/^>\s?(.*)$/))) {
        if (!inQuote) { closeBlocks(); html.push('<blockquote class="md-quote">'); inQuote = true; }
        html.push("<p>" + inline(m[1]) + "</p>"); return;
      }
      if ((m = line.match(/^[-*]\s+(.*)$/))) {
        if (!inUL) { closeBlocks(); html.push('<ul class="md-ul">'); inUL = true; }
        html.push("<li>" + inline(m[1]) + "</li>"); return;
      }
      if ((m = line.match(/^\d+[.、]\s*(.*)$/))) {
        if (!inOL) { closeBlocks(); html.push('<ol class="md-ol">'); inOL = true; }
        html.push("<li>" + inline(m[1]) + "</li>"); return;
      }
      if (line === "") { closeBlocks(); return; }
      closeBlocks(); html.push("<p>" + inline(line) + "</p>");
    });
    closeBlocks();
    return html.join("\n");

    function inline(s) {
      return s
        .replace(/`([^`]+)`/g, function (_, c) { return '<code class="md-code">' + c + "</code>"; })
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, t, u) {
          var href = /^https?:\/\//i.test(u) ? u : (u.charAt(0) === "/" ? u : "");
          if (!href) return t;
          return '<a class="md-a" href="' + href + '" target="_blank" rel="noopener noreferrer">' + t + "</a>";
        });
    }
  }

  /* ---------- 状态 ---------- */
  var state = {
    unlocked: sessionStorage.getItem(UNLOCK_KEY) === "1",
    token: sessionStorage.getItem(TOKEN_KEY) || "",
    auth: BLOG_AUTH,
    siteFields: {},
    siteGroups: {},
    siteValues: {},
    posts: [],
    drafts: loadDrafts()
  };
  function loadDrafts() {
    try {
      var raw = localStorage.getItem(DRAFTS_KEY);
      if (!raw) return { added: [], edited: {}, deleted: [] };
      var d = JSON.parse(raw);
      return { added: Array.isArray(d.added) ? d.added : [], edited: d.edited || {}, deleted: Array.isArray(d.deleted) ? d.deleted : [] };
    } catch (e) { return { added: [], edited: {}, deleted: [] }; }
  }
  function saveDrafts() {
    try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(state.drafts)); } catch (e) {}
  }

  /* ---------- 鉴权 ---------- */
  function getAuth() {
    return fetch(api("/api/publish/auth"), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.salt && d.hash) {
          state.auth = { alg: d.alg || "sha256-iter", iterations: parseInt(d.iterations || 10000, 10), salt: d.salt, hash: d.hash };
        }
        return state.auth;
      })
      .catch(function () { return state.auth; }); // 网关拉不到就用源码里这份兜底
  }
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
      .catch(function () {});
  }
  function tryUnlock() {
    var pw = $("#pwInput").value;
    if (!pw) { showPwError("请输入密码"); return; }
    var btn = $("#btnUnlock"); var old = btn.textContent;
    btn.disabled = true; btn.textContent = "校验中…"; hidePwError();
    getAuth().then(function (auth) {
      return hashPassword(pw, auth).then(function (got) {
        if (safeEqual(got, auth.hash)) {
          state.unlocked = true;
          try { sessionStorage.setItem(UNLOCK_KEY, "1"); } catch (e) {}
          requestToken(normalizePassword(pw));
          enterPanel();
          return;
        }
        showPwError("密码不对，再试试。");
        $("#pwInput").value = ""; $("#pwInput").focus();
      });
    }).catch(function (err) {
      showPwError("校验失败：" + String((err && err.message) || err));
    }).then(function () {
      btn.disabled = false; btn.textContent = old;
    });
  }
  function showPwError(m) { var e = $("#pwError"); e.hidden = false; e.textContent = m; }
  function hidePwError() { $("#pwError").hidden = true; }

  function enterPanel() {
    $("#lockScreen").hidden = true;
    $("#adminPanel").hidden = false;
    $("#meState").hidden = false;
    $("#meState").textContent = "● 已解锁（令牌 2 小时有效）";
    // 默认先拉站点文案
    loadSite();
  }

  /* ---------- 确认框（带可选验证码） ---------- */
  var cf = { onOk: null };
  function showConfirm(opts) {
    cf.onOk = opts.onOk;
    $("#cfHeading").textContent = opts.heading || "确认";
    $("#cfText").textContent = opts.text || "";
    $("#cfError").hidden = true;
    if (opts.needCaptcha) {
      $("#cfCaptchaWrap").hidden = false;
      refreshCfCaptcha();
    } else {
      $("#cfCaptchaWrap").hidden = true;
    }
    $("#confirmModal").hidden = false;
  }
  function hideConfirm() { $("#confirmModal").hidden = true; }
  function cfCaptchaId() { return $("#cfCaptchaImg").getAttribute("data-id"); }
  function refreshCfCaptcha() {
    var id = capId();
    $("#cfCaptchaImg").setAttribute("data-id", id);
    $("#cfCaptchaImg").src = captchaUrl(id);
    $("#cfCaptchaAns").value = "";
  }
  function confirmOk() {
    var ans = clean($("#cfCaptchaAns").value, 16);
    var id = cfCaptchaId();
    if ($("#cfCaptchaWrap").hidden === false && !ans) { $("#cfError").hidden = false; $("#cfError").textContent = "请先填验证码"; return; }
    var btn = $("#cfOk"); btn.disabled = true; var old = btn.textContent; btn.textContent = "处理中…";
    Promise.resolve(cf.onOk ? cf.onOk(id, ans) : null)
      .then(function () { hideConfirm(); })
      .catch(function (err) {
        $("#cfError").hidden = false;
        $("#cfError").textContent = String((err && err.message) || err || "操作失败");
        if ($("#cfCaptchaWrap").hidden === false) refreshCfCaptcha();
      })
      .then(function () { btn.disabled = false; btn.textContent = old; });
  }

  /* ---------- 站点文案面板 ---------- */
  function loadSite() {
    setStatus("siteStatus", "加载中…");
    fetch(api("/api/site"), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        state.siteFields = (d && d.fields) || {};
        state.siteGroups = (d && d.groups) || {};
        state.siteValues = (d && d.values) || {};
        renderSiteForm();
        setStatus("siteStatus", "已载入当前文案。", "ok");
      })
      .catch(function () { setStatus("siteStatus", "拉取站点文案失败，检查网络后点「保存」重试。", "err"); });
  }
  function renderSiteForm() {
    var form = $("#siteForm");
    form.innerHTML = "";
    var fields = state.siteFields, groups = state.siteGroups, values = state.siteValues;
    // 分组顺序：groups 对象的插入顺序
    var groupKeys = Object.keys(groups);
    // 把字段按 group 归类
    var byGroup = {};
    Object.keys(fields).forEach(function (k) {
      var g = fields[k].group || "extra";
      (byGroup[g] = byGroup[g] || []).push(k);
    });
    groupKeys.forEach(function (g) {
      if (!byGroup[g] || !byGroup[g].length) return;
      var box = document.createElement("div");
      box.className = "grp";
      var h = document.createElement("h3");
      h.textContent = groups[g] || g;
      box.appendChild(h);
      byGroup[g].forEach(function (k) {
        var def = fields[k];
        var wrap = document.createElement("div");
        wrap.className = "field";
        var lab = document.createElement("label");
        lab.textContent = def.label || k;
        wrap.appendChild(lab);
        var input;
        var cur = values[k];
        if (def.mode === "lines" || def.mode === "items") {
          input = document.createElement("textarea");
          input.className = "modal-textarea";
          input.rows = def.mode === "lines" ? 5 : 3;
          input.value = (Array.isArray(cur) ? cur : []).join("\n");
        } else if (def.type === "textarea") {
          input = document.createElement("textarea");
          input.className = "modal-textarea";
          input.rows = 4;
          input.value = cur == null ? "" : String(cur);
        } else {
          input = document.createElement("input");
          input.className = "modal-input";
          input.type = "text";
          input.value = cur == null ? "" : String(cur);
        }
        input.setAttribute("data-key", k);
        wrap.appendChild(input);
        var hint = document.createElement("div");
        hint.className = "hint";
        hint.textContent = (def.mode === "lines" ? "每行一条" : def.mode === "items" ? "每条一项，回车分隔" : "")
          + (def.max ? "（最多 " + def.max + " 字）" : "")
          + "　留空 = 恢复首页默认文案";
        wrap.appendChild(hint);
        box.appendChild(wrap);
      });
      form.appendChild(box);
    });
  }
  function collectSite() {
    var out = {};
    $$("#siteForm [data-key]").forEach(function (input) {
      var k = input.getAttribute("data-key");
      var def = state.siteFields[k] || {};
      var v = input.value;
      if (def.mode === "lines" || def.mode === "items") {
        var arr = v.split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
        out[k] = arr;
      } else {
        out[k] = v;
      }
    });
    return out;
  }
  function saveSite() {
    var values = collectSite();
    setStatus("siteStatus", "保存中…");
    fetch(api("/api/site"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: state.token, values: values })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (res.ok && res.d && res.d.ok) {
          state.siteValues = res.d.values || {};
          renderSiteForm();
          setStatus("siteStatus", "已保存，首页刷新后即生效。", "ok");
        } else {
          setStatus("siteStatus", "保存失败：" + ((res.d && res.d.error) || "未知错误"), "err");
        }
      })
      .catch(function (e) { setStatus("siteStatus", "保存失败：" + String(e), "err"); });
  }
  function resetSite() {
    // 把所有字段置空 → 网关删除覆盖 → 首页恢复默认
    var values = {};
    Object.keys(state.siteFields).forEach(function (k) { values[k] = ""; });
    setStatus("siteStatus", "恢复中…");
    fetch(api("/api/site"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: state.token, values: values })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (res.ok && res.d && res.d.ok) { state.siteValues = res.d.values || {}; renderSiteForm(); setStatus("siteStatus", "已恢复首页默认文案。", "ok"); }
        else setStatus("siteStatus", "恢复失败：" + ((res.d && res.d.error) || ""), "err");
      })
      .catch(function (e) { setStatus("siteStatus", "恢复失败：" + String(e), "err"); });
  }

  /* ---------- 文章面板 ---------- */
  function loadPosts() {
    setStatus("postsStatus", "加载中…");
    fetch(apiQ("/api/posts", { t: Date.now() }), { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) { state.posts = (d && Array.isArray(d.posts)) ? d.posts : []; renderPosts(); setStatus("postsStatus", "共 " + (state.posts.length + countDrafts()) + " 篇（含草稿）。", "ok"); })
      .catch(function (e) { setStatus("postsStatus", "文章加载失败：" + String(e), "err"); });
  }
  function countDrafts() {
    return state.drafts.added.length + Object.keys(state.drafts.edited).length;
  }
  function mergedPosts() {
    var byId = {};
    state.posts.forEach(function (p) { byId[p.id] = p; });
    Object.keys(state.drafts.edited).forEach(function (id) { if (byId[id]) byId[id] = state.drafts.edited[id]; });
    state.drafts.deleted.forEach(function (id) { delete byId[id]; });
    var all = Object.keys(byId).map(function (k) { return byId[k]; });
    state.drafts.added.forEach(function (p) { all.push(p); });
    all.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    return all;
  }
  function renderPosts() {
    var list = $("#postList");
    list.innerHTML = "";
    var posts = mergedPosts();
    if (!posts.length) { list.innerHTML = '<p class="empty">还没有文章，点「新建文章」开始写。</p>'; return; }
    posts.forEach(function (p) {
      var item = document.createElement("div");
      item.className = "post-item";
      var main = document.createElement("div");
      main.className = "pi-main";
      var title = document.createElement("div");
      title.className = "pi-title";
      var isDraft = state.drafts.added.some(function (x) { return x.id === p.id; }) || Object.prototype.hasOwnProperty.call(state.drafts.edited, p.id);
      title.textContent = p.title + (isDraft ? "（草稿）" : "");
      var meta = document.createElement("div");
      meta.className = "pi-meta";
      meta.textContent = (p.date || "") + " · " + (Array.isArray(p.tags) && p.tags.length ? p.tags.join(" / ") : "无标签");
      main.appendChild(title); main.appendChild(meta);
      item.appendChild(main);

      var edit = document.createElement("button");
      edit.className = "btn btn-ghost mini"; edit.textContent = "编辑";
      edit.onclick = function () { openEditor(p); };
      var del = document.createElement("button");
      del.className = "btn btn-ghost mini"; del.textContent = "删除";
      del.onclick = function () { deletePost(p); };
      item.appendChild(edit); item.appendChild(del);
      list.appendChild(item);
    });
  }
  var editingId = null;
  function openEditor(post) {
    editingId = post ? post.id : null;
    $("#edHeading").textContent = post ? "编辑文章" : "新建文章";
    $("#edTitle").value = post ? (post.title || "") : "";
    $("#edDate").value = post ? (post.date || today()) : today();
    $("#edTags").value = post ? (Array.isArray(post.tags) ? post.tags.join(", ") : "") : "";
    $("#edBody").value = post ? (post.body || "") : "";
    $("#edError").hidden = true;
    $("#editorModal").hidden = false;
    setTimeout(function () { $("#edTitle").focus(); }, 30);
  }
  function closeEditor() { $("#editorModal").hidden = true; editingId = null; }
  function collectPost() {
    var title = clean($("#edTitle").value, 120);
    if (!title) { $("#edTitle").focus(); flashEdError("标题不能为空"); return null; }
    return {
      id: editingId || uid(),
      title: title,
      date: clean($("#edDate").value, 20) || today(),
      tags: clean($("#edTags").value, 200).split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean),
      body: $("#edBody").value
    };
  }
  function flashEdError(m) { var e = $("#edError"); e.hidden = false; e.textContent = m; }
  function saveDraft() {
    var post = collectPost(); if (!post) return;
    var local = state.drafts;
    if (local.added.some(function (x) { return x.id === post.id; })) {
      local.added = local.added.map(function (x) { return x.id === post.id ? post : x; });
    } else if (Object.prototype.hasOwnProperty.call(local.edited, post.id)) {
      local.edited[post.id] = post;
    } else if (state.posts.some(function (p) { return p.id === post.id; })) {
      local.edited[post.id] = post; // 改的是线上已有的
    } else {
      local.added.push(post); // 全新的
    }
    saveDrafts(); renderPosts();
    setStatus("postsStatus", "已存到本机草稿（未上线）。", "ok");
    closeEditor();
  }
  function publishPost() {
    var post = collectPost(); if (!post) return;
    showConfirm({
      heading: "发布上线",
      text: "这篇文章会立刻写到网关，所有访客都能看到。",
      needCaptcha: true,
      onOk: function (capId, capAns) {
        return fetch(api("/api/posts"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: state.token, captchaId: capId, captchaAnswer: capAns, post: post })
        })
          .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
          .then(function (res) {
            if (res.ok && res.d && res.d.ok) {
              // 从草稿里清掉
              state.drafts.added = state.drafts.added.filter(function (x) { return x.id !== post.id; });
              delete state.drafts.edited[post.id];
              saveDrafts();
              closeEditor();
              loadPosts();
              setStatus("postsStatus", "已发布上线。", "ok");
            } else {
              throw new Error((res.d && res.d.error) || "发布失败");
            }
          });
      }
    });
  }
  function deletePost(post) {
    showConfirm({
      heading: "删除文章",
      text: "确定删除《" + (post.title || post.id) + "》？此操作不可撤销。",
      needCaptcha: true,
      onOk: function (capId, capAns) {
        return fetch(api("/api/posts/delete"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: state.token, captchaId: capId, captchaAnswer: capAns, id: post.id })
        })
          .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
          .then(function (res) {
            if (res.ok && res.d && res.d.ok) { loadPosts(); }
            else throw new Error((res.d && res.d.error) || "删除失败");
          });
      }
    });
  }

  /* ---------- 评论面板 ---------- */
  function loadComments() {
    setStatus("commentsStatus", "加载中…");
    fetch(apiQ("/api/admin/comments", { token: state.token, t: Date.now() }), { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status + (r.status === 403 ? "（未授权，重新解锁试试）" : "")); return r.json(); })
      .then(function (d) {
        var list = (d && Array.isArray(d.comments)) ? d.comments : [];
        renderComments(list);
        setStatus("commentsStatus", "共 " + list.length + " 条评论。", "ok");
      })
      .catch(function (e) { setStatus("commentsStatus", "评论加载失败：" + String(e), "err"); });
  }
  function renderComments(list) {
    var box = $("#commentList");
    box.innerHTML = "";
    if (!list.length) { box.innerHTML = '<p class="empty">还没有评论。</p>'; return; }
    list.forEach(function (c) {
      var item = document.createElement("div");
      item.className = "cm-item" + (c.pinned ? " pinned" : "");
      var head = document.createElement("div");
      head.className = "cm-head";
      head.innerHTML =
        '<span class="cm-nick">' + esc(c.nickname || "匿名") + "</span>" +
        '<span class="cm-floor">#' + (c.floor || 0) + "</span>" +
        '<span class="cm-post">@' + esc(c.post || "") + "</span>" +
        '<span class="cm-time">' + esc(String(c.created_at || "")) + "</span>" +
        (c.pinned ? '<span class="cm-floor" style="color:var(--amber)">置顶</span>' : "");
      var body = document.createElement("div");
      body.className = "cm-body";
      body.textContent = c.content || "";
      if (c.image) {
        var img = document.createElement("img");
        img.src = apiQ("/api/image", { file: c.image });
        img.alt = "配图";
        body.appendChild(document.createElement("br"));
        body.appendChild(img);
      }
      var ops = document.createElement("div");
      ops.className = "cm-ops";
      var pinBtn = document.createElement("button");
      pinBtn.className = "btn btn-ghost mini";
      pinBtn.textContent = c.pinned ? "取消置顶" : "置顶";
      pinBtn.onclick = function () { togglePin(c.id, !c.pinned); };
      var delBtn = document.createElement("button");
      delBtn.className = "btn btn-ghost mini"; delBtn.textContent = "删除";
      delBtn.onclick = function () { deleteComment(c.id); };
      ops.appendChild(pinBtn); ops.appendChild(delBtn);
      item.appendChild(head); item.appendChild(body); item.appendChild(ops);
      box.appendChild(item);
    });
  }
  function togglePin(id, pinned) {
    setStatus("commentsStatus", "操作中…");
    fetch(api("/api/admin/comments/pin"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: state.token, id: id, pinned: pinned })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) { if (res.ok && res.d && res.d.ok) loadComments(); else throw new Error((res.d && res.d.error) || ""); })
      .catch(function (e) { setStatus("commentsStatus", "操作失败：" + String(e), "err"); });
  }
  function deleteComment(id) {
    showConfirm({
      heading: "删除评论",
      text: "确定删除这条评论？不需要删除码，凭令牌即可。",
      needCaptcha: false,
      onOk: function () {
        return fetch(api("/api/admin/comments/delete"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: state.token, id: id })
        })
          .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
          .then(function (res) {
            if (res.ok && res.d && res.d.ok) loadComments();
            else throw new Error((res.d && res.d.error) || "删除失败");
          });
      }
    });
  }

  /* ---------- 密码面板 ---------- */
  function loadPwCaptcha() {
    var id = capId();
    var img = $("#pwCaptchaImg");
    img.setAttribute("data-id", id);
    img.src = captchaUrl(id);
    $("#pwCaptchaAns").value = "";
  }
  function changePassword() {
    var oldPw = $("#pwOld").value, newPw = $("#pwNew").value;
    var ans = clean($("#pwCaptchaAns").value, 16), id = $("#pwCaptchaImg").getAttribute("data-id");
    if (!oldPw || !newPw) { setStatus("pwStatus", "请填当前密码和新密码。", "err"); return; }
    if (!ans) { setStatus("pwStatus", "请先填验证码。", "err"); return; }
    setStatus("pwStatus", "修改中…");
    fetch(api("/api/admin/password"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: state.token, oldPassword: oldPw, newPassword: newPw, captchaId: id, captchaAnswer: ans })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (res.ok && res.d && res.d.ok) {
          setStatus("pwStatus", "密码已修改。下次解锁请用新密码。", "ok");
          $("#pwOld").value = ""; $("#pwNew").value = ""; $("#pwCaptchaAns").value = "";
          loadPwCaptcha();
          // 用新密码重新换令牌，避免当前会话登出
          requestToken(normalizePassword(newPw));
        } else {
          setStatus("pwStatus", "修改失败：" + ((res.d && res.d.error) || ""), "err");
          loadPwCaptcha();
        }
      })
      .catch(function (e) { setStatus("pwStatus", "修改失败：" + String(e), "err"); loadPwCaptcha(); });
  }

  /* ---------- tab 切换 ---------- */
  function switchTab(name) {
    $$("#tabs button").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-tab") === name); });
    ["site", "posts", "comments", "password"].forEach(function (t) {
      $("#tab-" + t).classList.toggle("active", t === name);
    });
    if (name === "posts") loadPosts();
    else if (name === "comments") loadComments();
    else if (name === "password") loadPwCaptcha();
  }

  /* ---------- 绑定与启动 ---------- */
  function bind() {
    $("#btnUnlock").onclick = tryUnlock;
    $("#pwInput").addEventListener("keydown", function (e) { if (e.key === "Enter") tryUnlock(); });
    $$("#tabs button").forEach(function (b) { b.onclick = function () { switchTab(b.getAttribute("data-tab")); }; });

    $("#btnSaveSite").onclick = saveSite;
    $("#btnResetSite").onclick = resetSite;

    $("#btnNewPost").onclick = function () { openEditor(null); };
    $("#btnRefreshPosts").onclick = loadPosts;
    $("#edClose").onclick = closeEditor;
    $("#edCancel").onclick = closeEditor;
    $("#edSave").onclick = saveDraft;
    $("#edPublish").onclick = publishPost;

    $("#btnRefreshComments").onclick = loadComments;

    $("#btnChangePw").onclick = changePassword;
    $("#pwCaptchaImg").onclick = loadPwCaptcha;

    $("#cfCancel").onclick = hideConfirm;
    $("#cfOk").onclick = confirmOk;
    $("#cfCaptchaImg").onclick = refreshCfCaptcha;
  }

  function boot() {
    bind();
    if (state.unlocked && state.token) {
      enterPanel();
    } else {
      setTimeout(function () { $("#pwInput").focus(); }, 30);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
