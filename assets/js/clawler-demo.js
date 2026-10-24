/* ============================================================
   pen-pig.github.io — clawler-demo.js
   gdgzoi-clawler 网页交互演示：终端命令 / 输出 / 历史 / Tab 补全
   说明：这是「交互演示」——命令与输出格式和真实爬虫一致，
   数据为预置样例（浏览器同源策略够不到学校 OJ）。
   ============================================================ */
(function () {
  "use strict";

  /* ---------- 预置演示数据（DEMO DATA，非真实抓取） ---------- */
  var CONTESTS = [
    { id: "2026-autumn", name: "2026 秋季赛", problems: 8, players: 42, date: "2026-10-18" },
    { id: "2026-spring", name: "2026 春季赛", problems: 6, players: 38, date: "2026-04-12" }
  ];

  var RANK = [
    { rank: 1, user: "XPH_csc",      solved: 8, penalty: 374,  note: "AK" },
    { rank: 2, user: "Sparse_Table", solved: 7, penalty: 512,  note: "" },
    { rank: 3, user: "wsk_oier",     solved: 7, penalty: 606,  note: "" },
    { rank: 4, user: "zzx_GDG",      solved: 6, penalty: 445,  note: "" },
    { rank: 5, user: "qmkk",         solved: 6, penalty: 688,  note: "" },
    { rank: 6, user: "pen-pig",      solved: 5, penalty: 703,  note: "我" },
    { rank: 7, user: "lhx_2024",     solved: 5, penalty: 815,  note: "" },
    { rank: 8, user: "dry_ice",      solved: 4, penalty: 402,  note: "" },
    { rank: 9, user: "Tofu_noob",    solved: 3, penalty: 511,  note: "" },
    { rank: 10, user: "cy_8086",     solved: 3, penalty: 640,  note: "" }
  ];

  var SUBS = [
    { t: "21:14:02", user: "pen-pig",   p: "P3 二分",   v: "AC",  lang: "C++", ms: 36 },
    { t: "21:09:47", user: "XPH_csc",   p: "P8 树DP",  v: "AC",  lang: "C++", ms: 62 },
    { t: "21:02:11", user: "qmkk",      p: "P5 贪心",   v: "WA",  lang: "Python", ms: 188 },
    { t: "20:58:33", user: "wsk_oier",  p: "P5 贪心",   v: "AC",  lang: "C++", ms: 44 },
    { t: "20:51:20", user: "pen-pig",   p: "P5 贪心",   v: "AC",  lang: "C++", ms: 41 },
    { t: "20:44:05", user: "zzx_GDG",   p: "P2 模拟",   v: "TLE", lang: "Java", ms: 1020 },
    { t: "20:39:58", user: "lhx_2024",  p: "P2 模拟",   v: "AC",  lang: "C++", ms: 29 },
    { t: "20:31:12", user: "Tofu_noob", p: "P1 签到",   v: "AC",  lang: "Python", ms: 152 },
    { t: "20:22:40", user: "pen-pig",   p: "P2 模拟",   v: "WA",  lang: "C",   ms: 33 },
    { t: "20:15:09", user: "cy_8086",   p: "P1 签到",   v: "AC",  lang: "C++", ms: 26 }
  ];

  var COMMANDS = ["help", "rank", "submissions", "search", "stats", "export", "about", "clear"];

  /* ---------- DOM ---------- */
  var out = document.getElementById("termOut");
  var input = document.getElementById("termInput");
  var form = document.getElementById("termForm");
  if (!out || !input || !form) return;

  /* ---------- 打字机引擎（行队列；输入在播放时锁定） ---------- */
  var queue = [];
  var playing = false;

  function printLine(text, cls) {
    var p = document.createElement("p");
    if (cls) p.className = cls;
    p.textContent = text;
    out.appendChild(p);
    out.scrollTop = out.scrollHeight;
  }

  function printHTML(html) {
    var p = document.createElement("p");
    p.innerHTML = html;
    out.appendChild(p);
    out.scrollTop = out.scrollHeight;
  }

  function play() {
    if (playing) return;
    var job = queue.shift();
    if (!job) { input.disabled = false; input.focus(); return; }
    playing = true;
    input.disabled = true;
    if (job.kind === "line") {
      printLine(job.text, job.cls);
      setTimeout(play, job.delay || 16);
    } else { // type：逐字符
      var p = document.createElement("p");
      if (job.cls) p.className = job.cls;
      out.appendChild(p);
      var i = 0;
      (function tick() {
        p.textContent = job.text.slice(0, ++i);
        out.scrollTop = out.scrollHeight;
        if (i < job.text.length) {
          setTimeout(tick, job.speed || 12);
        } else {
          setTimeout(play, job.delay || 16);
        }
      })();
    }
  }

  function enqueue(job) { queue.push(job); play(); }
  function say(text, cls) { enqueue({ kind: "line", text: text, cls: cls }); }

  /* ---------- 命令实现 ---------- */
  function pad(s, n) {
    s = String(s);
    while (s.length < n) s += " ";
    return s;
  }
  function padStart(s, n) {
    s = String(s);
    while (s.length < n) s = " " + s;
    return s;
  }

  function cmdHelp() {
    say("可用命令：", "dim");
    say("  rank [比赛ID]        查看榜单（默认最新一场）", "");
    say("  submissions [--recent N]  最近提交（默认 8 条）", "");
    say("  search <用户名>      查某个人的战绩", "");
    say("  stats                总体统计", "");
    say("  export csv|json      导出榜单（真的会下载）", "");
    say("  about                关于这个爬虫", "");
    say("  clear                清屏", "");
    say("提示：↑↓ 翻历史命令，Tab 补全命令名。", "dim");
  }

  function findContest(id) {
    if (!id) return CONTESTS[0];
    for (var i = 0; i < CONTESTS.length; i++) if (CONTESTS[i].id === id) return CONTESTS[i];
    return null;
  }

  function cmdRank(args) {
    var c = findContest(args[0]);
    if (!c) {
      say("找不到比赛「" + args[0] + "」。可用：", "err");
      CONTESTS.forEach(function (x) { say("  " + x.id + "  " + x.name, ""); });
      return;
    }
    say("【" + c.name + "】 " + c.date + " · " + c.problems + " 题 · " + c.players + " 人参赛", "ok");
    say(padStart("#", 3) + " " + pad("user", 14) + padStart("solved", 7) + padStart("penalty", 9) + "  note", "dim");
    RANK.forEach(function (r) {
      var cls = r.user === "pen-pig" ? "me" : "";
      say(padStart(r.rank, 3) + " " + pad(r.user, 14) + padStart(r.solved, 7) + padStart(r.penalty, 9) + "  " + r.note, cls);
    });
    say("（DEMO DATA — 交互演示，非真实抓取）", "dim");
  }

  function cmdSubs(args) {
    var n = 8;
    var ri = args.indexOf("--recent");
    if (ri >= 0 && args[ri + 1]) n = Math.max(1, Math.min(20, parseInt(args[ri + 1], 10) || 8));
    say("最近 " + n + " 条提交（DEMO DATA）：", "ok");
    SUBS.slice(0, n).forEach(function (s) {
      var cls = s.v === "AC" ? "ok" : (s.v === "WA" ? "warn" : "err");
      say(pad(s.t, 9) + pad(s.user, 12) + pad(s.p, 10) + pad(s.v, 5) + pad(s.lang, 8) + s.ms + "ms", cls);
    });
  }

  function cmdSearch(args) {
    var name = args.join(" ");
    if (!name) { say("用法：search <用户名>", "warn"); return; }
    var hit = null;
    RANK.forEach(function (r) { if (r.user.toLowerCase() === name.toLowerCase()) hit = r; });
    if (!hit) { say("榜单里没有「" + name + "」。试试 search pen-pig", "err"); return; }
    say("用户 " + hit.user + "：", "ok");
    say("  2026 秋季赛：第 " + hit.rank + " 名，过 " + hit.solved + " 题，罚时 " + hit.penalty, "");
    var own = SUBS.filter(function (s) { return s.user === hit.user; });
    if (own.length) {
      say("  最近提交：", "dim");
      own.forEach(function (s) {
        say("    " + s.t + "  " + s.p + "  " + s.v + "  " + s.lang + " " + s.ms + "ms", s.v === "AC" ? "ok" : "warn");
      });
    }
  }

  function cmdStats() {
    var total = 1284;
    say("GDGZOI 数据统计（截至 2026-10-23）：", "ok");
    say("  比赛数：   " + CONTESTS.length, "");
    say("  参赛人数： 42", "");
    say("  提交总数： " + total.toLocaleString(), "");
    say("  通过率：   61.3%", "");
    say("  最近同步： 2026-10-23 21:14", "dim");
    say("（DEMO DATA）", "dim");
  }

  function cmdExport(args) {
    var fmt = (args[0] || "").toLowerCase();
    if (fmt !== "csv" && fmt !== "json") {
      say("用法：export csv   或   export json", "warn");
      return;
    }
    var content, mime, name;
    if (fmt === "csv") {
      var rows = ["rank,user,solved,penalty"];
      RANK.forEach(function (r) { rows.push(r.rank + "," + r.user + "," + r.solved + "," + r.penalty); });
      content = rows.join("\n") + "\n";
      mime = "text/csv";
      name = "gdgzoi-rank-2026-autumn.csv";
    } else {
      content = JSON.stringify({ contest: CONTESTS[0], ranking: RANK }, null, 2) + "\n";
      mime = "application/json";
      name = "gdgzoi-rank-2026-autumn.json";
    }
    var blob = new Blob([content], { type: mime });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    say("已导出 " + name + "（" + content.length + " 字节）", "ok");
    say("真实爬虫的导出走同一套格式，只是数据来自 OJ 实时抓取。", "dim");
  }

  function cmdAbout() {
    say("gdgzoi-clawler — 学校 OJ（GDGZOI）数据爬虫", "ok");
    say("  C++ 编写；代码由 AI 生成，我负责需求、设计与验证。", "");
    say("  抓取比赛榜单与提交记录，整理成可排序的总表，支持 CSV / JSON 导出。", "");
    say("  原版跑在本机或服务器；你在浏览器里的是交互演示。", "dim");
  }

  /* ---------- 命令分发 ---------- */
  var history = [];
  var hIdx = -1;

  function run(raw) {
    var line = raw.trim();
    if (!line) return;
    history.push(line);
    if (history.length > 50) history.shift();
    hIdx = history.length;

    printHTML('<span class="tp">pen-pig@gdgzoi:~$</span> ' + escapeHTML(line));

    var parts = line.split(/\s+/);
    var cmd = parts[0].toLowerCase();
    var args = parts.slice(1);

    switch (cmd) {
      case "help": cmdHelp(); break;
      case "rank": cmdRank(args); break;
      case "submissions": case "subs": cmdSubs(args); break;
      case "search": cmdSearch(args); break;
      case "stats": cmdStats(); break;
      case "export": cmdExport(args); break;
      case "about": cmdAbout(); break;
      case "clear": out.innerHTML = ""; break;
      default:
        say("command not found: " + cmd + " — 输入 help 看看有什么", "err");
    }
  }

  function escapeHTML(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* ---------- 输入交互 ---------- */
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (input.disabled) return;
    var v = input.value;
    input.value = "";
    run(v);
  });

  input.addEventListener("keydown", function (e) {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (hIdx > 0) { hIdx--; input.value = history[hIdx]; }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (hIdx < history.length - 1) { hIdx++; input.value = history[hIdx]; }
      else { hIdx = history.length; input.value = ""; }
    } else if (e.key === "Tab") {
      e.preventDefault();
      var v = input.value.trim().toLowerCase();
      if (!v) return;
      var hit = COMMANDS.filter(function (c) { return c.indexOf(v) === 0; });
      if (hit.length === 1) input.value = hit[0] + " ";
      else if (hit.length > 1) say(hit.join("   "), "dim");
    }
  });

  /* ---------- 快捷命令条：点击 = 填入并执行 ---------- */
  Array.prototype.forEach.call(document.querySelectorAll(".clawler-chip"), function (btn) {
    btn.addEventListener("click", function () {
      if (input.disabled) return;
      input.value = btn.getAttribute("data-cmd") || "";
      input.focus();
      form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    });
  });

  /* ---------- 欢迎序列（打字机） ---------- */
  function welcome() {
    enqueue({ kind: "type", text: "gdgzoi-clawler v1.2.0 — interactive demo", cls: "ok", speed: 18, delay: 120 });
    say("DEMO DATA — 命令和输出与真实爬虫一致，数据是预置样例", "dim");
    say("真实版本跑在本机/服务器，抓学校 OJ（GDGZOI）的榜单与提交。", "dim");
    say("输入 help 查看命令；↑↓ 翻历史；Tab 补全。", "");
    say("", "");
  }

  welcome();
  input.focus();
})();
