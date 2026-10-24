/* ============================================================
   pen-pig.github.io — tour-demo.js
   website 模块导览：左侧切换 / hash 深链 / 无 JS 时全部平铺展示
   ============================================================ */
(function () {
  "use strict";

  var items = Array.prototype.slice.call(document.querySelectorAll(".tour-nav-item"));
  var panels = Array.prototype.slice.call(document.querySelectorAll(".tour-panel"));
  if (!items.length || !panels.length) return;

  /* 无 JS 时所有面板平铺可见；有 JS 时收成导览模式 */
  document.querySelector(".tour-content").classList.add("tour-content-js");

  function show(mod) {
    var found = false;
    items.forEach(function (b) {
      var on = b.getAttribute("data-mod") === mod;
      b.classList.toggle("on", on);
      if (on) found = true;
    });
    if (!found) { // hash 指向不存在的模块 → 回退第一个
      items[0].classList.add("on");
      mod = items[0].getAttribute("data-mod");
    }
    panels.forEach(function (p) {
      p.classList.toggle("on", p.getAttribute("data-panel") === mod);
    });
    if (location.hash !== "#" + mod) history.replaceState(null, "", "#" + mod);
  }

  items.forEach(function (b) {
    b.addEventListener("click", function () { show(b.getAttribute("data-mod")); });
  });

  window.addEventListener("hashchange", function () {
    show(location.hash.replace(/^#/, ""));
  });

  var initial = location.hash.replace(/^#/, "");
  show(initial || items[0].getAttribute("data-mod"));
})();
