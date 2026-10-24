/* ============================================================
   pen-pig.github.io — site.js
   站点文案覆盖层。

   页面里的文案本来写死在 HTML 里（静态优先：网关挂了页面也完整可读）。
   后台改过的文案存在网关的 data/site.json，这里拉下来贴到对应元素上。
   某个字段没有覆盖值，就继续用 HTML 里的原文。

   谁该被覆盖、覆盖到哪个元素，由网关返回的字段表决定 ——
   字段表是唯一真相源，后台表单和这里用的是同一份。
   ============================================================ */
(function () {
  "use strict";

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

  var values = {};
  var fields = {};
  var applied = false;

  /* ---------- 应用覆盖 ---------- */

  // 启动日志：每行一条。行首的 [    0.000000] 单独包一个 span.t，
  // 行尾带 ✓ 的算成功行（绿色）。
  function applyLines(el, list) {
    el.textContent = "";
    for (var i = 0; i < list.length; i++) {
      var line = String(list[i]);
      var p = document.createElement("p");
      var m = /^\s*(\[[^\]]*\])/.exec(line);
      if (m) {
        var t = document.createElement("span");
        t.className = "t";
        t.textContent = m[1];
        p.appendChild(t);
        p.appendChild(document.createTextNode(line.slice(m[1].length)));
        if (line.indexOf("✓") >= 0) p.className = "ok";
      } else {
        p.textContent = line;
      }
      el.appendChild(p);
    }
  }

  // 滚动横幅：每条一项，中间用 // 分隔（末尾也带一个，接缝才连得上）
  function applyItems(el, list) {
    el.textContent = "";
    for (var i = 0; i < list.length; i++) {
      var s = document.createElement("span");
      s.textContent = String(list[i]);
      el.appendChild(s);
      var b = document.createElement("b");
      b.textContent = "//";
      el.appendChild(b);
    }
    // 存一份「单份」内容：main.js 复制成两份之前要先还原它
    el.setAttribute("data-origin", el.innerHTML);
  }

  function applyField(key, def, value) {
    var el = document.getElementById(def.sel);
    if (!el) return;
    if (def.attr) {
      el.setAttribute(def.attr, String(value));
      return;
    }
    if (def.mode === "lines") { applyLines(el, value); return; }
    if (def.mode === "items") { applyItems(el, value); return; }
    el.textContent = String(value);
    // HERO 名字的乱码解码要还原成新文案，目标文本放这里
    el.setAttribute("data-final", String(value));
  }

  // 洛谷 UID 改了，所有指向洛谷主页的链接一起换
  function syncLuoguLinks(uid) {
    var links = document.querySelectorAll("[data-luogu-user]");
    for (var i = 0; i < links.length; i++) {
      links[i].setAttribute("href", "https://www.luogu.com.cn/user/" + encodeURIComponent(uid));
    }
  }

  function apply() {
    if (applied) return;
    applied = true;
    var keys = Object.keys(values);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var def = fields[key];
      if (!def) continue;
      var value = values[key];
      if (value === "" || value === null || value === undefined) continue;
      if (def.mode === "lines" || def.mode === "items") {
        if (!Array.isArray(value) || !value.length) continue;
      }
      applyField(key, def, value);
    }
    if (values["oi.uid"]) syncLuoguLinks(values["oi.uid"]);
    document.dispatchEvent(new CustomEvent("site:applied"));
  }

  /* ---------- 拉取 ---------- */

  function load() {
    return fetch(api("/api/site"), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d) return;
        if (d.fields && typeof d.fields === "object") fields = d.fields;
        if (d.values && typeof d.values === "object") values = d.values;
        apply();
      })
      .catch(function () { /* 网关不可达：保持 HTML 里的静态文案 */ });
  }

  // main.js 等这个 promise 再跑依赖文案的动效（乱码解码 / 打字机 / 横幅复制）
  var ready = load();

  window.PenPigSite = {
    ready: ready,
    get values() { return values; },
    get fields() { return fields; },
    apply: apply
  };
})();
