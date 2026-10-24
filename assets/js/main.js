/* ============================================================
   pen-pig.github.io — main.js
   动效原则：只动 transform / opacity；尊重 prefers-reduced-motion；
   所有内容在 HTML 中已有静态版本，JS 失败时页面完整可读。

   站点文案可能被 assets/js/site.js 从网关拉回来覆盖，
   所以依赖文案的三个动效（乱码解码 / 打字机 / 横幅）都等它就位再跑，
   迟到的覆盖会触发一次重跑 —— 旧一轮的定时器必须作废，否则会叠行。
   ============================================================ */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  /* ---------- 0. 动效轮次 ---------- */
  var scrambleRun = 0;          // 乱码解码轮次：重跑时上一轮的定时器靠它作废
  var bootRun = 0;              // 打字机轮次：同上，两个动效各用一个，别互相作废
  var textAnimsStarted = false; // 动效是否已经跑过（决定迟到的覆盖要不要重跑）

  /* ---------- 1. HERO 标题：乱码解码动效 ---------- */
  function scramble() {
    var el = $("#heroName");
    if (!el) return;
    // 目标文本放在 data-final 里：动画途中 textContent 是乱码，不能拿它当目标。
    // site.js 覆盖文案时会顺手把 data-final 更新成新值。
    var finalText = el.getAttribute("data-final");
    if (finalText === null) finalText = el.textContent;
    if (reduceMotion) { el.textContent = finalText; return; } // 静态文案已在 HTML 中

    var my = ++scrambleRun;
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!<>-_/[]{}|+=*#";
    var frame = 0;
    var totalFrames = finalText.length * 3 + 8;

    (function tick() {
      if (my !== scrambleRun) return;
      var out = "";
      for (var i = 0; i < finalText.length; i++) {
        if (i < frame / 3) {
          out += finalText[i];
        } else if (finalText[i] === " ") {
          out += " ";
        } else {
          out += chars[Math.floor(Math.random() * chars.length)];
        }
      }
      el.textContent = out;
      frame++;
      if (frame <= totalFrames) {
        setTimeout(tick, 42);
      } else {
        el.textContent = finalText;
      }
    })();
  }

  /* ---------- 2. 启动日志：打字机（从静态内容"重播"） ---------- */
  function typeBootLog() {
    var box = $("#bootLog");
    if (!box) return;

    // 保存静态行（无 JS / 减弱动效时直接展示）
    var lines = $$("p", box).map(function (p) { return p.cloneNode(true); });

    if (reduceMotion) return;

    var my = ++bootRun;
    box.innerHTML = "";
    var lineIdx = 0;

    function typeLine() {
      if (my !== bootRun || lineIdx >= lines.length) return;
      var line = lines[lineIdx];
      var tSpan = $(".t", line);
      var ts = tSpan ? tSpan.textContent : "";
      var rest = line.textContent.slice(ts.length);
      var isOk = line.classList.contains("ok");

      var p = document.createElement("p");
      if (isOk) p.className = "ok";
      var t = document.createElement("span");
      t.className = "t";
      t.textContent = ts;
      p.appendChild(t);
      p.appendChild(document.createTextNode(""));
      box.appendChild(p);

      var ci = 0;
      (function typeChar() {
        if (my !== bootRun) return;
        if (ci <= rest.length) {
          p.lastChild.nodeValue = rest.slice(0, ci);
          ci++;
          setTimeout(typeChar, rest.charAt(ci - 1) === " " ? 8 : 14);
        } else {
          lineIdx++;
          setTimeout(typeLine, 130);
        }
      })();
    }

    // 首屏加载后稍作停顿再开始，等 fadeUp 入场完成
    setTimeout(typeLine, 650);
  }

  /* ---------- 3. 滚动显现（IntersectionObserver） ---------- */
  function setupReveal() {
    var items = $$(".reveal");
    if (!("IntersectionObserver" in window)) {
      items.forEach(function (el) { el.classList.add("in-view"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });

    // 同容器内的兄弟元素依次延迟，形成波浪
    var groups = {};
    items.forEach(function (el) {
      var key = el.parentElement;
      groups[key] = (groups[key] || 0);
      el.style.setProperty("--d", groups[key] + "ms");
      groups[key] += 90;
      io.observe(el);
    });
  }

  /* ---------- 4. 数字滚动（count-up） ---------- */
  function setupCountUp() {
    var nums = $$(".spec-num[data-target]");
    if (!nums.length) return;

    function animate(el) {
      var target = parseFloat(el.getAttribute("data-target"));
      var suffix = el.getAttribute("data-suffix") || "";
      var decimals = (String(target).split(".")[1] || "").length;
      var dur = 1100;
      var t0 = null;

      function frame(ts) {
        if (!t0) t0 = ts;
        var k = Math.min((ts - t0) / dur, 1);
        var eased = 1 - Math.pow(1 - k, 5); // ease-out-quint
        el.textContent = (target * eased).toFixed(decimals) + suffix;
        if (k < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }

    if (reduceMotion || !("IntersectionObserver" in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          animate(entry.target);
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.6 });
    nums.forEach(function (n) { io.observe(n); });
  }

  /* ---------- 5. 光标辉光（仅精确指针 + 未减弱动效） ---------- */
  function setupCursorGlow() {
    var glow = $("#cursorGlow");
    if (!glow || !finePointer || reduceMotion) return;

    var tx = window.innerWidth / 2, ty = window.innerHeight / 2;
    var cx = tx, cy = ty;
    var raf = null;

    function loop() {
      cx += (tx - cx) * 0.12;
      cy += (ty - cy) * 0.12;
      glow.style.transform = "translate3d(" + cx + "px," + cy + "px,0) translate(-50%,-50%)";
      if (Math.abs(tx - cx) > 0.5 || Math.abs(ty - cy) > 0.5) {
        raf = requestAnimationFrame(loop);
      } else {
        raf = null;
      }
    }

    window.addEventListener("pointermove", function (e) {
      if (e.pointerType !== "mouse") return;
      tx = e.clientX;
      ty = e.clientY;
      glow.classList.add("on");
      if (!raf) raf = requestAnimationFrame(loop);
    }, { passive: true });

    document.addEventListener("mouseleave", function () { glow.classList.remove("on"); });
  }

  /* ---------- 6. TICKER 无缝循环（复制一倍内容） ---------- */
  function setupTicker() {
    var track = $("#tickerTrack");
    if (!track || reduceMotion) return;
    // data-origin 存的是「一份」的内容：site.js 覆盖横幅时会把它一起更新，
    // 重跑前先还原成一份，再复制成两份，接缝才连得上。
    var origin = track.getAttribute("data-origin");
    if (origin) {
      track.innerHTML = origin;
    } else {
      origin = track.innerHTML;
      track.setAttribute("data-origin", origin);
    }
    track.innerHTML += track.innerHTML;
  }

  /* ---------- 7. 导航高亮当前章节 ---------- */
  function setupNavActive() {
    var links = $$(".nav-links a[data-nav]");
    if (!links.length || !("IntersectionObserver" in window)) return;

    var map = {};
    links.forEach(function (a) { map[a.getAttribute("data-nav")] = a; });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var link = map[entry.target.id];
        if (!link) return;
        if (entry.isIntersecting) {
          links.forEach(function (a) { a.classList.remove("active"); });
          link.classList.add("active");
        }
      });
    }, { rootMargin: "-38% 0px -55% 0px" });

    ["about", "projects", "oi", "contact"].forEach(function (id) {
      var sec = document.getElementById(id);
      if (sec) io.observe(sec);
    });
  }

  /* ---------- 8. HERO 轻微视差（只动 transform） ---------- */
  function setupParallax() {
    if (!finePointer || reduceMotion) return;
    var term = $(".hero-term .term");
    var bg = $(".hero-bg");
    if (!term) return;

    var raf = null;
    window.addEventListener("pointermove", function (e) {
      if (e.pointerType !== "mouse") return;
      if (raf) return;
      raf = requestAnimationFrame(function () {
        var dx = (e.clientX / window.innerWidth - 0.5);
        var dy = (e.clientY / window.innerHeight - 0.5);
        term.style.transform = "translate3d(" + dx * -10 + "px," + dy * -8 + "px,0)";
        if (bg) bg.style.transform = "translate3d(" + dx * 8 + "px," + dy * 6 + "px,0)";
        raf = null;
      });
    }, { passive: true });
  }

  /* ---------- 启动 ---------- */

  // 依赖文案的三个动效：乱码解码 / 打字机 / 横幅复制
  function runTextAnims() {
    textAnimsStarted = true;
    setupTicker();
    scramble();
    typeBootLog();
  }

  // 站点文案覆盖层（assets/js/site.js）就位后，迟到的覆盖要重跑一遍动效。
  // 正常情况下覆盖在动效开始前就完成了，这时什么都不用做。
  document.addEventListener("site:applied", function () {
    if (!textAnimsStarted) return;
    runTextAnims();
  });

  // 等覆盖层把值贴好再跑动效；网关慢或挂了也不能把首屏拖住，最多等 2 秒
  function whenSiteReady(cb) {
    var site = window.PenPigSite;
    if (!site || !site.ready || typeof site.ready.then !== "function") { cb(); return; }
    var fired = false;
    function run() {
      if (fired) return;
      fired = true;
      cb();
    }
    var timer = setTimeout(run, 2000);
    site.ready.then(function () { clearTimeout(timer); run(); },
                    function () { clearTimeout(timer); run(); });
  }

  function init() {
    setupReveal();
    setupCountUp();
    setupNavActive();
    setupCursorGlow();
    setupParallax();
    whenSiteReady(runTextAnims);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
