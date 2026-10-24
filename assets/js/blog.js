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
  /* 发布密码：纯前端常量，只防无意访问、不防刻意破解（看源码就能看到）。
     想改密码，改这个字符串即可。 */
  var BLOG_PASS = "cerulia";

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
    setTimeout(function () { el.pwInput.focus(); }, 30);
  }
  function closePwModal() { el.pwModal.hidden = true; }

  function tryUnlock() {
    if (el.pwInput.value === BLOG_PASS) {
      state.unlocked = true;
      sessionStorage.setItem(UNLOCK_KEY, "1");
      closePwModal();
      render();
    } else {
      el.pwError.hidden = false;
      el.pwInput.value = "";
      el.pwInput.focus();
    }
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
