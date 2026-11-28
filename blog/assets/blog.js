/* pen-pig 博客：静态渲染 + 密码管理（删除/写文章）
 * 数据源：posts.json（全网数据）+ localStorage（本机草稿/隐藏）
 * 管理密码与游戏开发者模式同源：sha256(SALT + 密码) 校验
 */
(function () {
    "use strict";

    /* ---------- 常量 ---------- */
    var SALT = "oscillight::dev::v1::";
    var ADMIN_HASH = "82433c0eff7a818815e8a1c09117789696ace7fc9b96efb2b6f7b93d71f9ea2d";
    var GH_REPO = "pen-pig/pen-pig.github.io";
    var POSTS_PATH = "blog/posts.json";
    var GH_BRANCH = "main";

    var K_ADMIN = "penpig_blog_admin";     // sessionStorage
    var K_TOKEN = "penpig_blog_token";     // localStorage
    var K_HIDDEN = "penpig_blog_hidden";   // localStorage, JSON array
    var K_LOCAL = "penpig_blog_local";     // localStorage, JSON array

    /* ---------- 状态 ---------- */
    var state = { remote: [], ready: false, failed: false };
    var toastTimer = null;

    /* ---------- 工具 ---------- */
    function $(id) { return document.getElementById(id); }

    function esc(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    function sha256hex(s) {
        return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)).then(function (buf) {
            var arr = new Uint8Array(buf), out = "";
            for (var i = 0; i < arr.length; i++) out += arr[i].toString(16).padStart(2, "0");
            return out;
        });
    }

    function b64utf8(str) {
        var bytes = new TextEncoder().encode(str);
        var bin = "", CHUNK = 0x8000;
        for (var i = 0; i < bytes.length; i += CHUNK) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        return btoa(bin);
    }

    function readJSON(key, fallback) {
        try {
            var v = JSON.parse(localStorage.getItem(key) || "null");
            return v == null ? fallback : v;
        } catch (e) { return fallback; }
    }
    function writeJSON(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

    function hiddenSet() { return new Set(readJSON(K_HIDDEN, [])); }
    function localPosts() { return readJSON(K_LOCAL, []); }

    function nowLocal() {
        var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); };
        return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
            " " + p(d.getHours()) + ":" + p(d.getMinutes());
    }

    function excerptOf(md, n) {
        var t = String(md || "")
            .replace(/```[\s\S]*?```/g, " ")
            .replace(/`([^`]*)`/g, "$1")
            .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, "$1")
            .replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1")
            .replace(/^#{1,6}\s+/gm, "")
            .replace(/[*_>#]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        n = n || 76;
        return t.length > n ? t.slice(0, n) + "…" : t;
    }

    function toast(msg) {
        var el = $("toast");
        el.textContent = msg;
        el.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2800);
    }

    /* ---------- 弹窗 ---------- */
    function openModal(html) {
        var mask = document.createElement("div");
        mask.className = "modal-mask";
        mask.innerHTML = '<div class="modal">' + html + "</div>";
        document.body.appendChild(mask);
        function onKey(e) { if (e.key === "Escape") close(); }
        function close() { mask.remove(); document.removeEventListener("keydown", onKey); }
        document.addEventListener("keydown", onKey);
        mask.addEventListener("mousedown", function (e) { if (e.target === mask) close(); });
        return { mask: mask, close: close };
    }

    function tokenFieldHTML() {
        if (localStorage.getItem(K_TOKEN)) {
            return '<label>GitHub Token（已保存，仅存于本机浏览器）</label>' +
                '<input type="password" id="gh-token" autocomplete="off">';
        }
        return '<label>GitHub Token（全网生效必填；仅保存在本机浏览器，不会发给任何第三方）</label>' +
            '<input type="password" id="gh-token" placeholder="github_pat_… / ghp_…" autocomplete="off">' +
            '<p class="hint" style="margin-top:6px">在 GitHub → Settings → Developer settings → Fine-grained tokens 创建，勾选本仓库的 Contents 读写权限即可。</p>';
    }

    function getTokenFrom(modal) {
        var saved = localStorage.getItem(K_TOKEN) || "";
        var input = modal.mask.querySelector("#gh-token");
        var v = input && input.value.trim() ? input.value.trim() : saved;
        return v;
    }

    /* ---------- GitHub API ---------- */
    function ghHeaders(token) {
        return {
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.github+json"
        };
    }

    function ghReq(path, options) {
        return fetch("https://api.github.com" + path, options).then(function (res) {
            return res.json().catch(function () { return null; }).then(function (data) {
                if (!res.ok) {
                    throw new Error((data && data.message) ? data.message : ("HTTP " + res.status));
                }
                return data;
            });
        });
    }

    function commitPosts(token, posts, commitMsg) {
        var content = b64utf8(JSON.stringify({ posts: posts }, null, 2) + "\n");
        return ghReq("/repos/" + GH_REPO + "/contents/" + POSTS_PATH + "?ref=" + GH_BRANCH,
            { headers: ghHeaders(token) })
            .then(function (meta) {
                return ghReq("/repos/" + GH_REPO + "/contents/" + POSTS_PATH, {
                    method: "PUT",
                    headers: Object.assign({ "Content-Type": "application/json" }, ghHeaders(token)),
                    body: JSON.stringify({
                        message: commitMsg,
                        content: content,
                        branch: GH_BRANCH,
                        sha: meta.sha
                    })
                });
            });
    }

    /* ---------- 数据 ---------- */
    function allPosts() {
        var hidden = hiddenSet();
        return state.remote.concat(localPosts())
            .filter(function (p) { return p && p.id && !hidden.has(p.id); })
            .sort(function (a, b) { return String(b.date || "").localeCompare(String(a.date || "")); });
    }

    function findPost(id) {
        var list = allPosts();
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return null;
    }

    function load() {
        state.ready = false;
        state.failed = false;
        renderRoute();
        fetch("posts.json", { cache: "no-store" }).then(function (res) {
            if (!res.ok) throw new Error("HTTP " + res.status);
            return res.json();
        }).then(function (data) {
            state.remote = (data && Array.isArray(data.posts)) ? data.posts : [];
            state.ready = true;
            renderRoute();
        }).catch(function () {
            state.failed = true;
            renderRoute();
        });
    }

    function errorBoxHTML(msg) {
        return '<div class="state-box">' + msg + '<br>' +
            '<button id="retry-btn" type="button">重试</button></div>';
    }

    function bindRetry() {
        var b = $("retry-btn");
        if (b) b.addEventListener("click", load);
    }

    /* ---------- 渲染 ---------- */
    var TRASH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/></svg>';

    function tagChips(tags) {
        return (tags || []).map(function (t) {
            return '<span class="tag">' + esc(t) + "</span>";
        }).join("");
    }

    function delBtnHTML(id) {
        return '<button class="del-btn" type="button" data-del="' + esc(id) + '" title="删除这篇文章">' + TRASH + "</button>";
    }

    function renderList() {
        $("list-view").hidden = false;
        $("post-view").hidden = true;
        var listEl = $("post-list");
        if (state.failed) {
            listEl.innerHTML = errorBoxHTML("文章加载失败，请检查网络后重试。");
            bindRetry();
            return;
        }
        if (!state.ready) {
            listEl.innerHTML = '<div class="state-box">加载中…</div>';
            return;
        }
        var posts = allPosts();
        var countEl = $("blog-count");
        if (countEl) countEl.textContent = posts.length ? "共 " + posts.length + " 篇" : "";
        if (!posts.length) {
            listEl.innerHTML = '<div class="state-box">还没有文章。</div>';
            return;
        }
        listEl.innerHTML = posts.map(function (p) {
            return '<div class="post-card">' +
                '<h2><a href="#/p/' + encodeURIComponent(p.id) + '">' + esc(p.title) + "</a></h2>" +
                '<p class="excerpt">' + esc(excerptOf(p.content)) + "</p>" +
                '<div class="meta">' + tagChips(p.tags) + "</div>" +
                '<div class="side"><span class="date">' + esc(String(p.date || "").slice(0, 10)) + "</span>" + delBtnHTML(p.id) + "</div>" +
                "</div>";
        }).join("");
    }

    function renderPost(id) {
        $("list-view").hidden = true;
        $("post-view").hidden = false;
        var p = findPost(id);
        var bodyEl = $("pv-body");
        if (!state.ready) {
            $("pv-title").textContent = state.failed ? "文章加载失败" : "加载中…";
            $("pv-meta").innerHTML = "";
            if (state.failed) {
                bodyEl.innerHTML = errorBoxHTML("请检查网络后重试。");
                bindRetry();
            } else {
                bodyEl.innerHTML = "";
            }
            return;
        }
        if (!p) {
            $("pv-title").textContent = "文章不存在或已被删除";
            $("pv-meta").innerHTML = "";
            bodyEl.innerHTML = '<p style="color:var(--muted)">它可能已被管理员删除，或链接有误。</p>';
            return;
        }
        $("pv-title").textContent = p.title;
        var adminDel = document.body.classList.contains("admin")
            ? ' <button class="link-del" type="button" data-del="' + esc(p.id) + '" style="color:#b3261e;background:none;border:none;cursor:pointer;font-size:.8rem;font-family:inherit;padding:0;text-decoration:underline">删除</button>'
            : "";
        $("pv-meta").innerHTML = '<span class="date">' + esc(String(p.date || "").slice(0, 10)) + "</span>" +
            tagChips(p.tags) + adminDel;
        if (window.marked && typeof marked.parse === "function") {
            bodyEl.innerHTML = marked.parse(String(p.content || ""));
        } else {
            bodyEl.innerHTML = "<pre>" + esc(p.content) + "</pre>";
        }
        window.scrollTo(0, 0);
    }

    function renderRoute() {
        var h = location.hash || "#/";
        var m = h.match(/^#\/p\/(.+)$/);
        if (m) renderPost(decodeURIComponent(m[1].split("?")[0]));
        else renderList();
    }

    window.addEventListener("hashchange", renderRoute);

    /* ---------- 管理模式 ---------- */
    function isAdmin() { return sessionStorage.getItem(K_ADMIN) === "1"; }

    function applyAdminUI() {
        document.body.classList.toggle("admin", isAdmin());
        $("admin-bar").hidden = !isAdmin();
        renderRoute(); // 刷新删除按钮显隐
    }

    function openPasswordModal() {
        var m = openModal(
            "<h3>管理登录</h3>" +
            '<p class="hint">输入管理密码后可删除文章或发布新文章。</p>' +
            '<input type="password" id="pw-input" placeholder="密码" autocomplete="off">' +
            '<div class="err" id="pw-err"></div>' +
            '<div class="row"><button type="button" id="pw-cancel">取消</button>' +
            '<button type="button" id="pw-ok" class="primary">进入管理</button></div>'
        );
        var input = m.mask.querySelector("#pw-input");
        var err = m.mask.querySelector("#pw-err");
        function tryUnlock() {
            var v = input.value;
            if (!v) { err.textContent = "请输入密码"; return; }
            sha256hex(SALT + v).then(function (h) {
                if (h === ADMIN_HASH) {
                    sessionStorage.setItem(K_ADMIN, "1");
                    m.close();
                    applyAdminUI();
                    toast("已进入管理模式");
                } else {
                    err.textContent = "密码不正确";
                    input.select();
                }
            }).catch(function () { err.textContent = "浏览器不支持 SHA-256，请换现代浏览器"; });
        }
        m.mask.querySelector("#pw-ok").addEventListener("click", tryUnlock);
        m.mask.querySelector("#pw-cancel").addEventListener("click", m.close);
        input.addEventListener("keydown", function (e) { if (e.key === "Enter") tryUnlock(); });
        setTimeout(function () { input.focus(); }, 50);
    }

    function exitAdmin() {
        sessionStorage.removeItem(K_ADMIN);
        applyAdminUI();
        toast("已退出管理模式");
    }

    /* ---------- 删除 ---------- */
    function openDeleteModal(post) {
        var isLocal = localPosts().some(function (p) { return p.id === post.id; });
        var m = openModal(
            "<h3>删除文章</h3>" +
            '<p class="hint">「' + esc(post.title) + "」<br>" +
            "· <b>全网删除</b>：提交到 GitHub 仓库，Pages 部署完成后所有访客都不再看到（需要 Token）。<br>" +
            "· <b>仅本机隐藏</b>：只在这台设备的浏览器里隐藏。" +
            (isLocal ? "<br>这篇文章只存在于本机，将直接删除。" : "") + "</p>" +
            (isLocal ? "" : tokenFieldHTML()) +
            '<div class="err" id="dl-err"></div>' +
            '<div class="row">' +
            '<button type="button" data-act="cancel">取消</button>' +
            (isLocal ? "" : '<button type="button" data-act="local">仅本机隐藏</button>') +
            '<button type="button" data-act="global" class="danger">' + (isLocal ? "删除" : "全网删除") + "</button>" +
            "</div>"
        );
        var err = m.mask.querySelector("#dl-err");
        var globalBtn = m.mask.querySelector('[data-act="global"]');
        var localBtn = m.mask.querySelector('[data-act="local"]');

        m.mask.querySelector('[data-act="cancel"]').addEventListener("click", m.close);

        function doLocal() {
            writeJSON(K_HIDDEN, readJSON(K_HIDDEN, []).concat([post.id]));
            var left = localPosts().filter(function (p) { return p.id !== post.id; });
            writeJSON(K_LOCAL, left);
            m.close();
            renderRoute();
            toast(isLocal ? "已删除" : "已在本机隐藏");
        }
        if (localBtn) localBtn.addEventListener("click", doLocal);
        if (isLocal) globalBtn.addEventListener("click", doLocal);

        globalBtn && globalBtn.addEventListener("click", function () {
            var token = getTokenFrom(m);
            if (!token) { err.textContent = "全网删除需要 GitHub Token；或改用「仅本机隐藏」。"; return; }
            localStorage.setItem(K_TOKEN, token);
            globalBtn.disabled = true;
            globalBtn.textContent = "提交中…";
            var rest = state.remote.filter(function (p) { return p.id !== post.id; });
            commitPosts(token, rest, 'blog: delete post "' + post.id + '"')
                .then(function () {
                    state.remote = rest;
                    writeJSON(K_HIDDEN, readJSON(K_HIDDEN, []).concat([post.id]));
                    m.close();
                    renderRoute();
                    toast("删除已提交，Pages 部署后全网生效");
                })
                .catch(function (e) {
                    err.textContent = "提交失败：" + e.message;
                    globalBtn.disabled = false;
                    globalBtn.textContent = "全网删除";
                });
        });
    }

    /* ---------- 写文章 ---------- */
    function openNewPostModal() {
        var m = openModal(
            "<h3>写文章</h3>" +
            '<p class="hint">正文支持 Markdown。发布后需等 GitHub Pages 部署完成（约 1 分钟）才对所有人可见。</p>' +
            '<label>标题</label><input type="text" id="np-title" maxlength="100">' +
            '<label>标签（用逗号分隔，可留空）</label><input type="text" id="np-tags" placeholder="日常, 折腾">' +
            "<label>正文（Markdown）</label>" +
            '<textarea id="np-content" placeholder="# 标题&#10;正文…"></textarea>' +
            tokenFieldHTML() +
            '<div class="err" id="np-err"></div>' +
            '<div class="row">' +
            '<button type="button" data-act="cancel">取消</button>' +
            '<button type="button" data-act="local">仅保存本机</button>' +
            '<button type="button" data-act="global" class="primary">全网发布</button>' +
            "</div>"
        );
        var err = m.mask.querySelector("#np-err");
        m.mask.querySelector('[data-act="cancel"]').addEventListener("click", m.close);

        function buildPost() {
            var title = m.mask.querySelector("#np-title").value.trim();
            var content = m.mask.querySelector("#np-content").value.replace(/\r\n/g, "\n").trim();
            var tags = m.mask.querySelector("#np-tags").value.split(/[,，]/)
                .map(function (s) { return s.trim(); }).filter(Boolean);
            if (!title) { err.textContent = "标题不能为空"; return null; }
            if (!content) { err.textContent = "正文不能为空"; return null; }
            return {
                id: "p-" + Date.now().toString(36),
                title: title,
                tags: tags,
                date: nowLocal(),
                content: content
            };
        }

        function afterPublish(post, scope) {
            m.close();
            renderRoute();
            toast(scope === "global"
                ? "发布已提交，Pages 部署后全网可见"
                : "已保存到本机");
        }

        m.mask.querySelector('[data-act="local"]').addEventListener("click", function () {
            var p = buildPost();
            if (!p) return;
            writeJSON(K_LOCAL, localPosts().concat([p]));
            afterPublish(p, "local");
        });

        m.mask.querySelector('[data-act="global"]').addEventListener("click", function () {
            var p = buildPost();
            if (!p) return;
            var token = getTokenFrom(m);
            if (!token) { err.textContent = "全网发布需要 GitHub Token；或先用「仅保存本机」。"; return; }
            localStorage.setItem(K_TOKEN, token);
            var btn = this;
            btn.disabled = true;
            btn.textContent = "提交中…";
            commitPosts(token, state.remote.concat([p]), 'blog: new post "' + p.id + '"')
                .then(function () {
                    state.remote = state.remote.concat([p]);
                    afterPublish(p, "global");
                })
                .catch(function (e) {
                    err.textContent = "提交失败：" + e.message;
                    btn.disabled = false;
                    btn.textContent = "全网发布";
                });
        });
    }

    /* ---------- 事件绑定 ---------- */
    document.addEventListener("click", function (e) {
        var del = e.target.closest("[data-del]");
        if (del && isAdmin()) {
            e.preventDefault();
            var p = findPost(del.getAttribute("data-del"));
            if (p) openDeleteModal(p);
        }
    });

    $("admin-entry").addEventListener("click", function () {
        if (isAdmin()) { toast("已在管理模式"); return; }
        openPasswordModal();
    });
    $("btn-admin-exit").addEventListener("click", exitAdmin);
    $("btn-new-post").addEventListener("click", openNewPostModal);

    /* ---------- 启动 ---------- */
    applyAdminUI();
    load();
})();
