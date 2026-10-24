/* ============================================================
   pen-pig.github.io — comments.js
   匿名评论：人机验证 + 服务端 IP 限流（10 秒 2 次）
   ------------------------------------------------------------
  后端是同仓库的 gateway/（Node 服务），负责：
    - 人机验证（Cloudflare Turnstile，或退回本地图形验证码）
    - 按来源 IP 限流
    - 把评论写进网关自己的本地 JSON 文件（不依赖任何外部服务）
   前端只负责：拿验证 → 填昵称/正文 → 提交 → 渲染
   ============================================================ */
(function () {
  "use strict";

  /* ---------- 配置 ---------- */
  /* 网关地址：线上是独立域名，与 GitHub Pages 不同源（走 CORS）。
     "?local=1" 强制走本地网关（联调用）。
     SHARE_CODE 是发布平台给应用的访问码，线上接口需要带上。 */
  var LOCAL_GATEWAY = "http://127.0.0.1:8791";
  var SHARE_CODE = "OBVHYSCDUX";
  var GATEWAY = (location.search.indexOf("local=1") >= 0)
    ? LOCAL_GATEWAY
    : "https://pen-pig-comment-gateway.app.workbuddy.host";

  /* 拼接接口地址：线上网关需要 sharecode，本地网关不需要 */
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

  var ENDPOINT = api("/api/comments");
  var CAPTCHA_URL = api("/api/captcha");

  /* ---------- 工具 ---------- */
  function $(s, c) { return (c || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function relTime(iso) {
    var t = new Date(iso).getTime();
    if (!t) return "";
    var d = Math.floor((Date.now() - t) / 1000);
    if (d < 60) return "刚刚";
    if (d < 3600) return Math.floor(d / 60) + " 分钟前";
    if (d < 86400) return Math.floor(d / 3600) + " 小时前";
    if (d < 86400 * 30) return Math.floor(d / 86400) + " 天前";
    return new Date(iso).toLocaleDateString("zh-CN");
  }

  /* ---------- 状态 ---------- */
  var state = {
    postId: "",
    captchaMode: "local",  // local | turnstile
    captchaId: "",
    turnstileToken: "",
    submitting: false,
    comments: [],
    ready: false
  };

  var el = {};

  /* ---------- DOM ---------- */
  function bindDom() {
    el.root = $("#commentSection");
    if (!el.root) return false;
    el.list = $("#cmtList");
    el.nick = $("#cmtNick");
    el.body = $("#cmtBody");
    el.answer = $("#cmtAnswer");
    el.img = $("#cmtCaptcha");
    el.reload = $("#cmtReload");
    el.submit = $("#cmtSubmit");
    el.status = $("#cmtStatus");
    el.count = $("#cmtCount");
    el.tsHost = $("#cmtTurnstile");
    el.localBox = $("#cmtLocalCaptcha");
    return true;
  }

  /* ---------- 人机验证：模式探测 ---------- */
  function detectCaptcha() {
    return fetch(apiQ("/api/captcha", { mode: "probe", t: Date.now() }), { method: "GET" })
      .then(function (r) {
        var ct = r.headers.get("Content-Type") || "";
        if (ct.indexOf("image/") >= 0) return { mode: "local" };
        return r.json();
      })
      .then(function (d) {
        if (d && d.mode === "turnstile") {
          state.captchaMode = "turnstile";
          state.turnstileSiteKey = d.siteKey;
          renderTurnstile();
        } else {
          state.captchaMode = "local";
          loadLocalCaptcha();
        }
        state.ready = true;
      })
      .catch(function () {
        // 网关不可达：仍显示本地验证码区，提交时会提示网络错误
        state.captchaMode = "local";
        loadLocalCaptcha();
        state.ready = true;
      });
  }

  /* ---------- Turnstile 挂件 ---------- */
  function renderTurnstile() {
    if (!el.tsHost) return;
    // 切到 Turnstile 模式时，本地图形验证码整块收起
    if (el.localBox) el.localBox.hidden = true;
    el.tsHost.hidden = false;
    if (window.turnstile) { mountTurnstile(); return; }
    var s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.defer = true;
    s.onload = mountTurnstile;
    document.head.appendChild(s);
  }

  function mountTurnstile() {
    if (!window.turnstile || !el.tsHost) return;
    if (window.__penpigTurnstileId) {
      try { window.turnstile.remove(window.__penpigTurnstileId); } catch (e) {}
    }
    el.tsHost.innerHTML = "";
    window.__penpigTurnstileId = window.turnstile.render(el.tsHost, {
      sitekey: state.turnstileSiteKey,
      callback: function (token) { state.turnstileToken = token; },
      "expired-callback": function () { state.turnstileToken = ""; },
      "error-callback": function () { state.turnstileToken = ""; }
    });
  }

  function resetTurnstile() {
    state.turnstileToken = "";
    if (window.turnstile && window.__penpigTurnstileId) {
      try { window.turnstile.reset(window.__penpigTurnstileId); } catch (e) {}
    }
  }

  /* ---------- 本地图形验证码 ---------- */
  function loadLocalCaptcha() {
    if (!el.img) return;
    // 客户端自己生成 id 并放进图片 URL，服务端按这个 id 存答案 ——
    // 这样「看到的图」和「提交的 id」必然是同一张验证码
    var id = "";
    try {
      var buf = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(buf);
      id = Array.prototype.map.call(buf, function (b) {
        return ("0" + b.toString(16)).slice(-2);
      }).join("");
    } catch (e) {
      // 兜底：也要保证是纯十六进制、长度 >= 16
      id = "";
      for (var i = 0; i < 4; i++) {
        id += Math.floor(Math.random() * 0xffffffff).toString(16);
      }
      id = id.slice(0, 32);
    }
    state.captchaId = id;
    var url = apiQ("/api/captcha", { id: id, t: Date.now() });
    // 跨源图片加上 crossOrigin，服务端已发 CORS 头，图片才能被 canvas 读取（便于自动化测试）
    el.img.crossOrigin = "anonymous";
    el.img.src = url;
  }

  /* ---------- 渲染评论 ---------- */
  function renderComments() {
    if (!el.list) return;
    if (!state.comments.length) {
      el.list.innerHTML = '<p class="cmt-empty">还没有评论，来抢第一条。</p>';
      return;
    }
    el.list.innerHTML = state.comments.map(function (c) {
      return (
        '<article class="cmt-item">' +
        '<header class="cmt-head">' +
        '<span class="cmt-nick">' + esc(c.nickname || "匿名") + "</span>" +
        '<time class="cmt-time" datetime="' + esc(c.created_at) + '">' + esc(relTime(c.created_at)) + "</time>" +
        "</header>" +
        '<p class="cmt-text">' + esc(c.content) + "</p>" +
        "</article>"
      );
    }).join("");
  }

  function loadComments() {
    if (!state.postId) return Promise.resolve();
    return fetch(apiQ("/api/comments", { post: state.postId }), { cache: "no-cache" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        state.comments = (d && d.comments) || [];
        if (el.count) el.count.textContent = state.comments.length + " 条评论";
        renderComments();
      })
      .catch(function () {
        if (el.list) el.list.innerHTML = '<p class="cmt-empty">评论加载失败——网关可能暂时不可用。</p>';
      });
  }

  /* ---------- 状态提示 ---------- */
  function setStatus(msg, kind) {
    if (!el.status) return;
    el.status.textContent = msg || "";
    el.status.className = "cmt-status" + (kind ? " is-" + kind : "");
    if (kind === "ok") {
      setTimeout(function () { el.status.textContent = ""; el.status.className = "cmt-status"; }, 4000);
    }
  }

  /* ---------- 提交 ---------- */
  function submit() {
    if (state.submitting) return;
    var content = el.body.value.trim();
    var nick = el.nick.value.trim() || "匿名";
    var answer = "";

    if (content.length < 2) { setStatus("评论太短了", "err"); el.body.focus(); return; }

    if (state.captchaMode === "turnstile") {
      answer = state.turnstileToken;
      if (!answer) { setStatus("请先完成人机验证", "err"); return; }
    } else {
      answer = el.answer.value.trim();
      if (!answer) { setStatus("请填写验证码答案", "err"); el.answer.focus(); return; }
      if (!state.captchaId) { setStatus("验证码还没准备好，稍等一下", "err"); loadLocalCaptcha(); return; }
    }

    state.submitting = true;
    el.submit.disabled = true;
    setStatus("提交中…");

    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        post: state.postId,
        nickname: nick,
        content: content,
        captchaId: state.captchaId,
        captchaAnswer: answer
      })
    })
      .then(function (r) {
        return r.json().then(function (d) { return { status: r.status, data: d }; });
      })
      .then(function (res) {
        if (res.status === 200 && res.data && res.data.ok) {
          state.comments.push(res.data.comment);
          renderComments();
          if (el.count) el.count.textContent = state.comments.length + " 条评论";
          el.body.value = "";
          if (el.answer) el.answer.value = "";
          setStatus("已发布，谢谢！", "ok");
          if (state.captchaMode === "turnstile") resetTurnstile();
          else loadLocalCaptcha();
          return;
        }
        var msg = (res.data && res.data.error) || "发布失败";
        setStatus(msg, "err");
        // 验证凭证用过即废，任何失败都要换新的
        if (state.captchaMode === "turnstile") resetTurnstile();
        else loadLocalCaptcha();
      })
      .catch(function () {
        setStatus("网络错误，稍后再试", "err");
        if (state.captchaMode === "turnstile") resetTurnstile();
        else loadLocalCaptcha();
      })
      .then(function () {
        state.submitting = false;
        el.submit.disabled = false;
      });
  }

  /* ---------- 对外接口（供 blog.js 调用） ---------- */
  window.BlogComments = {
    mount: function (postId) {
      if (!bindDom()) return;
      state.postId = postId || "";
      detectCaptcha();
      loadComments();
      if (el.reload) el.reload.addEventListener("click", function () {
        if (state.captchaMode === "turnstile") resetTurnstile();
        else { loadLocalCaptcha(); if (el.answer) el.answer.value = ""; el.answer.focus(); }
      });
      if (el.submit) el.submit.addEventListener("click", submit);
      if (el.img) el.img.addEventListener("click", function () {
        loadLocalCaptcha();
        if (el.answer) el.answer.value = "";
      });
      if (el.answer) {
        el.answer.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
      }
    },
    refresh: loadComments
  };
})();
