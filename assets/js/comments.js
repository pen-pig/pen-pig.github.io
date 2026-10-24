/* ============================================================
   pen-pig.github.io — comments.js
   博客讨论区：楼号 · 头像 · 回复某楼 · 配图 · 删自己的评论
   ------------------------------------------------------------
  模型参考社团网站的讨论区（forum.php / post.php）：
    - 每条评论有楼号（#N 楼）
    - 首字母头像
    - 可以回复某一条（楼中楼，带层级缩进）
    - 可以配图（jpg/png/gif/webp，单张 ≤2MB）
    - 作者可以删掉自己那条（匿名无账号 → 用「删除码」代替密码）

  后端是同仓库的 gateway/（Node 服务），负责：
    - 人机验证（Cloudflare Turnstile，或退回本地图形验证码）
    - 按来源 IP 限流
    - 存进网关自己的本地 JSON 文件（不依赖任何外部服务）
    - 配图落盘 + 校验魔数，删除码只存哈希
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
  var DELETE_ENDPOINT = api("/api/comments/delete");

  var MAX_IMAGE_BYTES = 2 * 1024 * 1024;   // 与服务端一致

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
  /* 头像：昵称首字（对应讨论区里的 forum-avatar） */
  function initial(name) {
    var s = String(name || "匿").trim();
    return s ? s.charAt(0).toUpperCase() : "匿";
  }
  /* 按昵称生成稳定的头像色，让同一人的头像颜色一致 */
  function avatarHue(name) {
    var s = String(name || ""), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  }

  /* ---------- 状态 ---------- */
  var state = {
    postId: "",
    captchaMode: "local",  // local | turnstile
    captchaId: "",
    turnstileToken: "",
    submitting: false,
    comments: [],
    ready: false,
    replyTo: 0,            // 正在回复的楼号，0 = 顶层
    replyToNick: "",
    imageData: "",         // 选中的配图（data URL）
    imageName: ""
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
    el.file = $("#cmtImage");
    el.preview = $("#cmtImagePreview");
    el.previewImg = $("#cmtImagePreviewImg");
    el.previewName = $("#cmtImagePreviewName");
    el.previewClear = $("#cmtImageClear");
    el.replyBar = $("#cmtReplyBar");
    el.replyText = $("#cmtReplyText");
    el.replyCancel = $("#cmtReplyCancel");
    el.keyBox = $("#cmtKeyBox");
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
    if (window.turnstile && window.__penpigTurnstileId) window.turnstile.reset(window.__penpigTurnstileId);
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

  /* ---------- 楼号与层级 ----------
     楼号由服务端在创建时固定（本文第几条），删掉别的评论也不会漂移；
     老数据没有 floor 字段时回退到按时间排序的序号。
     渲染时把回复挂到被回复的那条下面，形成楼中楼。            */
  function buildTree(list) {
    var byFloor = {};
    list.forEach(function (c, i) {
      if (!c.floor) c.floor = i + 1;
      byFloor[c.floor] = c;
    });

    var kids = {}, roots = [], seen = {};
    list.forEach(function (c) {
      if (c.replyTo > 0 && byFloor[c.replyTo]) {
        if (!kids[c.replyTo]) kids[c.replyTo] = [];
        kids[c.replyTo].push(c);
      } else {
        roots.push(c);
      }
    });

    var out = [];
    function walk(c, depth) {
      if (seen[c.id]) return;
      seen[c.id] = true;
      c.__depth = depth;
      out.push(c);
      (kids[c.floor] || []).forEach(function (x) { walk(x, depth + 1); });
    }
    roots.forEach(function (r) { walk(r, 0); });
    // 兜底：目标已删除的回复，挂到最外层
    list.forEach(function (c) {
      if (!seen[c.id]) { c.__depth = 0; out.push(c); seen[c.id] = true; }
    });
    return out;
  }

  /* ---------- 渲染评论 ---------- */
  function renderComments() {
    if (!el.list) return;
    if (!state.comments.length) {
      el.list.innerHTML = '<p class="cmt-empty">还没有评论，来抢第一条。</p>';
      return;
    }
    var tree = buildTree(state.comments.slice());
    el.list.innerHTML = tree.map(function (c) {
      var nick = c.nickname || "匿名";
      var depth = c.__depth || 0;
      var hue = avatarHue(nick);
      var replyTo = "";
      if (c.replyTo > 0) {
        replyTo = '<p class="cmt-replyto">回复 <b>#' + c.replyTo + " 楼</b>" +
          (c.replyToNick ? " · " + esc(c.replyToNick) : "") + "</p>";
      }
      var img = "";
      if (c.image) {
        img = '<p class="cmt-imgwrap"><img class="cmt-img" loading="lazy" alt="评论配图" src="' +
          esc(apiQ("/api/image", { file: c.image })) + '"></p>';
      }
      return (
        '<article class="cmt-item' + (depth ? " cmt-item-sub" : "") + '" data-id="' + esc(c.id) + '"' +
        ' data-floor="' + c.floor + '" data-nick="' + esc(nick) + '"' +
        (depth ? ' style="--cmt-depth:' + depth + '"' : "") + '>' +
        '<div class="cmt-avatar" style="--h:' + hue + '" aria-hidden="true">' + esc(initial(nick)) + "</div>" +
        '<div class="cmt-main">' +
        '<header class="cmt-head">' +
        '<span class="cmt-nick">' + esc(nick) + "</span>" +
        '<span class="cmt-floor">#' + c.floor + " 楼</span>" +
        '<time class="cmt-time" datetime="' + esc(c.created_at) + '">' + esc(relTime(c.created_at)) + "</time>" +
        "</header>" +
        replyTo +
        '<p class="cmt-text">' + esc(c.content) + "</p>" +
        img +
        '<div class="cmt-ops">' +
        '<button class="cmt-op" type="button" data-act="reply">回复</button>' +
        '<button class="cmt-op cmt-op-del" type="button" data-act="del">删除</button>' +
        "</div>" +
        '<div class="cmt-delbox" hidden>' +
        '<input class="cmt-input cmt-delinput" type="text" placeholder="输入删除码" autocomplete="off" maxlength="64">' +
        '<button class="cmt-op cmt-op-ok" type="button" data-act="del-ok">确认删除</button>' +
        '<button class="cmt-op" type="button" data-act="del-cancel">取消</button>' +
        '<span class="cmt-status cmt-delmsg"></span>' +
        "</div>" +
        "</div>" +
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
  var statusTimer = null;
  function setStatus(msg, kind) {
    if (!el.status) return;
    // 只保留最新一条提示的定时器：否则上一条提示的延时清理会把新提示抹掉
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
    el.status.textContent = msg || "";
    el.status.className = "cmt-status" + (kind ? " is-" + kind : "");
    if (kind === "ok") {
      statusTimer = setTimeout(function () {
        statusTimer = null;
        el.status.textContent = "";
        el.status.className = "cmt-status";
      }, 4000);
    }
  }

  /* ---------- 回复态 ---------- */
  function enterReply(floor, nick) {
    state.replyTo = floor;
    state.replyToNick = nick;
    if (el.replyBar) {
      el.replyBar.hidden = false;
      if (el.replyText) el.replyText.textContent = "正在回复 #" + floor + " 楼 · " + nick;
    }
    if (el.body) { el.body.focus(); }
  }

  function exitReply() {
    state.replyTo = 0;
    state.replyToNick = "";
    if (el.replyBar) el.replyBar.hidden = true;
  }

  /* ---------- 配图选择 ---------- */
  function clearImage() {
    state.imageData = "";
    state.imageName = "";
    if (el.file) el.file.value = "";
    if (el.preview) el.preview.hidden = true;
  }

  function onFileChange(e) {
    var f = e.target.files && e.target.files[0];
    if (!f) { clearImage(); return; }
    if (!/^image\/(jpeg|png|gif|webp)$/.test(f.type)) {
      setStatus("只能上传 jpg / png / gif / webp", "err");
      clearImage();
      return;
    }
    if (f.size > MAX_IMAGE_BYTES) {
      setStatus("图片太大了（上限 2MB）", "err");
      clearImage();
      return;
    }
    var reader = new FileReader();
    reader.onload = function (ev) {
      state.imageData = String(ev.target.result || "");
      state.imageName = f.name;
      if (el.previewImg) el.previewImg.src = state.imageData;
      if (el.previewName) el.previewName.textContent = f.name;
      if (el.preview) el.preview.hidden = false;
    };
    reader.onerror = function () {
      setStatus("图片读取失败", "err");
      clearImage();
    };
    reader.readAsDataURL(f);
  }

  /* ---------- 删除码提示（只给提交者看一次） ---------- */
  function showDelKey(key) {
    if (!el.keyBox) return;
    el.keyBox.hidden = false;
    el.keyBox.innerHTML =
      '<b>删除码 ' + esc(key) + '</b> —— 复制留好，删掉刚才那条要用它（只显示这一次）' +
      '<button class="cmt-op" type="button" id="cmtKeyClose">知道了</button>';
    var close = $("#cmtKeyClose");
    if (close) close.addEventListener("click", function () { el.keyBox.hidden = true; });
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
        captchaAnswer: answer,
        replyTo: state.replyTo,
        replyToNick: state.replyToNick,
        image: state.imageData || ""
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
          clearImage();
          exitReply();
          setStatus("已发布，谢谢！", "ok");
          if (res.data.delKey) showDelKey(res.data.delKey);
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

  /* ---------- 删除 ---------- */
  function deleteComment(item, key) {
    var id = item.getAttribute("data-id");
    fetch(DELETE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: id, delKey: key })
    })
      .then(function (r) {
        return r.json().then(function (d) { return { status: r.status, data: d }; });
      })
      .then(function (res) {
        var msg = el.list.querySelector('[data-id="' + id + '"] .cmt-delmsg');
        if (res.status === 200 && res.data && res.data.ok) {
          state.comments = state.comments.filter(function (c) { return c.id !== id; });
          renderComments();
          if (el.count) el.count.textContent = state.comments.length + " 条评论";
          setStatus("已删除", "ok");
        } else {
          if (msg) { msg.textContent = (res.data && res.data.error) || "删除失败"; msg.className = "cmt-status cmt-delmsg is-err"; }
        }
      })
      .catch(function () {
        var msg = el.list.querySelector('[data-id="' + id + '"] .cmt-delmsg');
        if (msg) { msg.textContent = "网络错误"; msg.className = "cmt-status cmt-delmsg is-err"; }
      });
  }

  /* ---------- 列表内交互（事件委托） ---------- */
  function onListClick(e) {
    var btn = e.target.closest ? e.target.closest(".cmt-op") : null;
    if (!btn) return;
    var act = btn.getAttribute("data-act");
    var item = btn.closest(".cmt-item");
    if (!item) return;

    if (act === "reply") {
      var floor = item.getAttribute("data-floor") || "";
      var nick = item.getAttribute("data-nick") || "匿名";
      var box = item.querySelector(".cmt-delbox");
      if (box) box.hidden = true;
      enterReply(floor ? parseInt(floor, 10) : 0, nick);
      return;
    }

    if (act === "del") {
      var b = item.querySelector(".cmt-delbox");
      if (b) {
        b.hidden = false;
        var inp = item.querySelector(".cmt-delinput");
        if (inp) inp.focus();
      }
      return;
    }

    if (act === "del-cancel") {
      var bx = item.querySelector(".cmt-delbox");
      if (bx) bx.hidden = true;
      return;
    }

    if (act === "del-ok") {
      var input = item.querySelector(".cmt-delinput");
      var key = input ? input.value.trim() : "";
      if (!key) {
        var mm = item.querySelector(".cmt-delmsg");
        if (mm) { mm.textContent = "请输入删除码"; mm.className = "cmt-status cmt-delmsg is-err"; }
        return;
      }
      btn.disabled = true;
      deleteComment(item, key);
    }
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
      if (el.file) el.file.addEventListener("change", onFileChange);
      if (el.previewClear) el.previewClear.addEventListener("click", clearImage);
      if (el.replyCancel) el.replyCancel.addEventListener("click", exitReply);
      if (el.list) el.list.addEventListener("click", onListClick);
    },
    refresh: loadComments
  };
})();
