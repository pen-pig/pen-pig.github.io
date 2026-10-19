# pen-pig.github.io

个人主页。深色「系统控制台」风格——首屏是一段会自己敲出来的 boot log 终端。

🔗 **https://pen-pig.github.io/**

## 结构

| 路径 | 职责 |
| --- | --- |
| `index.html` | 单页全部内容（关于 / 项目 / 竞赛 / 联系） |
| `os.html` | 浏览器里运行 CeruliaOS 的演示页（v86 模拟器） |
| `assets/css/style.css` | 视觉系统，设计令牌在文件顶部 `:root` |
| `assets/js/main.js` | 动效：boot log 打字机、标题解码、滚动显现、数字滚动 |
| `assets/js/os-demo.js` | os.html 的模拟器控制：镜像探测 / 下载进度 / 启动 / 重启 / 全屏 |
| `assets/fonts/` | JetBrains Mono + Noto Sans SC，按页面用字子集化（共约 190KB，零外部依赖） |
| `assets/v86/` | v86 模拟器：`libv86.js` + `v86.wasm` + `bios/`（seabios / vgabios） |
| `assets/os/cerulia.img` | CeruliaOS 磁盘镜像（约 0.8MB，来自 `tools/make_image.py` 的 `os-image.bin`） |
| `.nojekyll` | 纯静态站点，跳过 Jekyll 处理 |

## 浏览器运行 CeruliaOS（os.html）

`os.html` 用 [v86](https://copy.sh/v86/)（WebAssembly x86 模拟器）在网页里启动真实的 CeruliaOS 磁盘镜像，走完整的 **BIOS → MBR → boot sector → stage2 → kernel** 引导链——屏幕输出全部是模拟器现场执行机器码的结果，没有任何录屏成分。

要点：

- 本版 v86 的 `v86.wasm` **不内置 BIOS**，`seabios.bin` / `vgabios.bin` 必须显式配置（已托管在 `assets/v86/bios/`）
- 镜像用 `fetch` 整块下载（带进度条）后以 buffer 模式挂到 hda；不用 v86 的 async 分块，几 MB 一次加载更稳
- 新版 v86 构造后由 `autostart: true` 自动启动，**不能手动调 `run()`**（内部 core 未就绪会抛 TypeError）

### 更新镜像

在 CeruliaOS 源码目录构建后，把 legacy 引导镜像放到本站：

```bash
python tools/make_image.py                  # 生成 os-image.bin（引导扇区 + stage2 + 内核，约 0.8MB）
cp os-image.bin <本站>/assets/os/cerulia.img
```

`os-image.bin` 无数据分区，因此浏览器版里文件系统相关命令不可用（shell、selftest 等内核功能完整）。

## 本地预览

直接双击 `index.html`，或起一个本地服务：

```bash
python -m http.server 8000   # 然后打开 http://localhost:8000
```

> 注意：本地验证 os.html 时镜像用 buffer 模式加载，不受服务器 Range 支持影响；线上（GitHub Pages CDN）两种模式都可用。

## 修改指南

- **改文案 / 链接**：编辑 `index.html`
- **改配色**：编辑 `style.css` 顶部 `:root` 中的 CSS 变量（`--accent` 磷光绿，`--amber` 琥珀）
- **加了新文字后**：页面用到的字符已固化进 `assets/fonts/` 的子集，新字符会回退到系统字体；如需重新生成子集，用 `pyftsubset` 以页面全部可见字符为 `--text-file` 重新裁剪即可
- **动效**：全部尊重 `prefers-reduced-motion`；关闭动效的用户会看到完整静态内容

## 部署

推送到 `main` → GitHub Actions（`.github/workflows/jekyll-gh-pages.yml`）自动构建 → Pages 发布，约 1 分钟。

## 说明

本站展示的项目（CeruliaOS、website、gdgzoi-clawler）代码由 AI 生成，由我负责需求、设计与验证。
