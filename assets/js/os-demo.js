/* ============================================================
   pen-pig.github.io — os-demo.js
   在网页里运行 CeruliaOS（v86 WebAssembly x86 模拟器）

   状态机：idle → checking → (missing | ready) → loading → running
          ↳ 任意状态可进 error
   原则：镜像用 fetch + 进度条自管（不用 v86 的 async 分块，几 MB 一次加载更稳）；
        JS 失败时页面静态内容（覆盖层说明）仍然完整可读。
   ============================================================ */
(function () {
  "use strict";

  var IMAGE_URL = "assets/os/cerulia.img";
  var WASM_PATH = "assets/v86/v86.wasm";
  // 本版 v86 的 wasm 不内置 BIOS，seabios/vgabios 必须显式提供
  var BIOS_PATH = "assets/v86/bios/seabios.bin";
  var VGA_BIOS_PATH = "assets/v86/bios/vgabios.bin";
  var MEM_SIZE = 128 * 1024 * 1024; // 128MB：留足 CeruliaOS 的 .bss(19MB) + PMM 池 + VBE LFB

  function $(id) { return document.getElementById(id); }
  function setText(el, s) { if (el) el.textContent = s; }

  var el = {
    overlay: $("osOverlay"),
    overlayInner: $("osOverlayInner"),
    kicker: $("osOverlayKicker"),
    text: $("osOverlayText"),
    progress: $("osProgress"),
    progressBar: $("osProgressBar"),
    btnStart: $("btnStart"),
    btnReset: $("btnReset"),
    btnFull: $("btnFull"),
    status: $("osStatus"),
    navStatus: $("navStatus"),
    screen: $("screenContainer"),
    wrap: $("screenWrap"),
    imageNote: $("osImageNote")
  };

  var emulator = null;
  var imageBuffer = null; // ArrayBuffer，启动后保留供 restart 复用
  var imageSize = 0;

  /* ---------- 状态切换 ---------- */
  function setState(state, opts) {
    opts = opts || {};
    var map = {
      checking: ["CHECKING", "正在确认磁盘镜像…", false],
      ready:    ["READY", "点击下方按钮，在网页里启动 CeruliaOS。", false],
      missing:  ["NO IMAGE", "", false],
      loading:  ["LOADING", "", false],
      running:  ["RUNNING", "", true],
      error:    ["ERROR", "", false]
    };
    var m = map[state] || map.ready;
    setText(el.navStatus, m[0]);
    if (el.status) {
      el.status.innerHTML = "";
      el.status.appendChild(document.createTextNode(m[0]));
      var dot = document.createElement("i");
      dot.className = "pulse-dot";
      dot.setAttribute("aria-hidden", "true");
      el.status.insertBefore(dot, el.status.firstChild);
    }
    if (el.btnStart) el.btnStart.disabled = (state === "missing" || state === "loading" || state === "running");
    if (el.btnReset) el.btnReset.disabled = (state !== "running");
    if (el.btnFull) el.btnFull.disabled = (state !== "running");

    // 覆盖层显隐
    if (el.overlay) {
      if (state === "running") {
        el.overlay.classList.add("os-overlay-hidden");
      } else {
        el.overlay.classList.remove("os-overlay-hidden");
      }
    }
    if (el.progress) el.progress.hidden = (state !== "loading");
    if (state === "running" && el.screen) el.screen.focus();
  }

  function showOverlay(kicker, html, cls) {
    if (!el.overlayInner) return;
    el.overlayInner.className = "os-overlay-inner" + (cls ? " " + cls : "");
    setText(el.kicker, kicker);
    if (el.text) el.text.innerHTML = html;
  }

  /* ---------- 1. 探测镜像 ---------- */
  function checkImage() {
    setState("checking");
    showOverlay("CHECKING", "正在确认磁盘镜像…");
    fetch(IMAGE_URL, { method: "HEAD" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      imageSize = parseInt(r.headers.get("content-length") || "0", 10);
      var sizeText = imageSize ? "（" + (imageSize / 1048576).toFixed(1) + " MB）" : "";
      setState("ready");
      showOverlay("READY", "磁盘镜像已就位" + sizeText + "。点击下方按钮，在网页里启动 CeruliaOS。");
    }).catch(function () {
      setState("missing");
      showOverlay(
        "NO IMAGE",
        "磁盘镜像还没有放进站点。<br>本地构建 CeruliaOS 后，把 legacy 引导镜像放到 <code>assets/os/cerulia.img</code> 即可。",
        "os-overlay-warn"
      );
      if (el.imageNote) {
        el.imageNote.innerHTML = "镜像尚未就位。生成方法：在 CeruliaOS 源码目录运行 <code>python tools/make_image.py</code> 得到 <code>os-image.bin</code>（引导扇区 + stage2 + 内核，无数据分区，约 0.8MB），把它放到本站 <code>assets/os/cerulia.img</code>。详见仓库 README。";
      }
    });
  }

  /* ---------- 2. 下载镜像（带进度） ---------- */
  function loadImage() {
    return fetch(IMAGE_URL).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      var total = parseInt(r.headers.get("content-length") || "0", 10);
      var reader = r.body && r.body.getReader ? r.body.getReader() : null;
      if (!reader) {
        // 老浏览器无流式读取：直接整块拿
        return r.arrayBuffer();
      }
      var chunks = [], received = 0;
      function pump() {
        return reader.read().then(function (res) {
          if (res.done) {
            imageBuffer = new Uint8Array(received);
            var pos = 0;
            for (var i = 0; i < chunks.length; i++) { imageBuffer.set(chunks[i], pos); pos += chunks[i].length; }
            imageSize = received;
            return imageBuffer;
          }
          chunks.push(new Uint8Array(res.value));
          received += res.value.length;
          if (el.progressBar && total) {
            el.progressBar.style.width = Math.min(100, (received / total) * 100).toFixed(1) + "%";
          }
          return pump();
        });
      }
      return pump();
    });
  }

  /* ---------- 3. 启动模拟器 ---------- */
  function start() {
    if (typeof V86 !== "function") {
      setState("error");
      showOverlay("ERROR", "v86 模拟器加载失败（libv86.js 缺失或浏览器不支持 WebAssembly）。刷新页面试试，或换现代浏览器。", "os-overlay-warn");
      return;
    }
    setState("loading");
    showOverlay("LOADING", "正在准备磁盘镜像…");

    var boot = imageBuffer ? Promise.resolve(imageBuffer) : loadImage();

    boot.then(function (buf) {
      if (el.progressBar) el.progressBar.style.width = "100%";
      showOverlay("LOADING", "镜像就绪，正在启动 x86 模拟器…");
      if (emulator) { try { emulator.destroy(); } catch (e) {} emulator = null; }
      // loadImage 可能返回 Uint8Array（流式）或 ArrayBuffer（老浏览器整块），统一成 ArrayBuffer
      var raw = buf instanceof ArrayBuffer ? buf : buf.buffer;
      emulator = new V86({
        screen_container: el.screen,
        wasm_path: WASM_PATH,
        bios: { url: BIOS_PATH },
        vga_bios: { url: VGA_BIOS_PATH },
        memory_size: MEM_SIZE,
        hda: { buffer: raw, size: raw.byteLength },
        boot_order: 0x132, // HD 优先（floppy 0x1, CD 0x2, HD 0x3 → 组合值）
        disable_speaker: true,
        autostart: true
      });
      // 注意：新版 v86 在 wasm 初始化完成后由 autostart 自动启动，
      // 此处不能手动调用 run()——内部 core 尚未就绪会抛 TypeError。
      // 用 emulator-started 事件确认 CPU 真正跑起来后再切 RUNNING，
      // 避免 wasm 加载失败时页面假装在运行。
      var started = false;
      if (typeof emulator.add_listener === "function") {
        emulator.add_listener("emulator-started", function () {
          started = true;
          setState("running");
          showOverlay("RUNNING", "");
        });
      }
      // 兜底：个别版本事件名差异时，3 秒后仍按运行处理
      setTimeout(function () {
        if (!started) { setState("running"); showOverlay("RUNNING", ""); }
      }, 3000);
    }).catch(function (err) {
      setState("error");
      showOverlay("ERROR", "启动失败：" + (err && err.message ? err.message : "未知错误") + "。<br>镜像可能尚未放置，或网络中断。修复后点击「启动」重试。", "os-overlay-warn");
    });
  }

  function restart() {
    if (!emulator) { start(); return; }
    try {
      emulator.restart();
      setState("running");
    } catch (e) {
      // restart 失败则整体重建
      try { emulator.destroy(); } catch (e2) {}
      emulator = null;
      start();
    }
  }

  /* ---------- 4. 全屏 ---------- */
  function toggleFull() {
    var target = el.wrap || el.screen;
    if (!target) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (target.requestFullscreen) {
      target.requestFullscreen().catch(function () {});
    }
  }

  /* ---------- 5. 事件绑定 ---------- */
  if (el.btnStart) el.btnStart.addEventListener("click", start);
  if (el.btnReset) el.btnReset.addEventListener("click", restart);
  if (el.btnFull) el.btnFull.addEventListener("click", toggleFull);

  // 点击屏幕：把键盘焦点交给虚拟机
  if (el.screen) {
    el.screen.addEventListener("pointerdown", function () {
      try { el.screen.focus(); } catch (e) {}
    });
  }

  // 离开页面时释放模拟器（省电 + 防后台跑飞）
  window.addEventListener("pagehide", function () {
    if (emulator) { try { emulator.destroy(); } catch (e) {} emulator = null; }
  });

  /* ---------- 启动：先探测镜像 ---------- */
  checkImage();
})();
