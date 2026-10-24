# pen-pig.github.io

个人主页。深色「系统控制台」风格——首屏是一段会自己敲出来的 boot log 终端。

🔗 **https://pen-pig.github.io/**

## 结构

| 路径 | 职责 |
| --- | --- |
| `index.html` | 单页全部内容（关于 / 项目 / 竞赛 / 联系） |
| `os.html` | 浏览器里运行 CeruliaOS 的演示页（v86 模拟器） |
| `blog.html` | 博客：文章公开可读，发布需密码 |
| `clawler.html` | gdgzoi-clawler 的网页试用（终端交互演示） |
| `site-demo.html` | PHP 项目（网站本体）的网页试用（7 模块导览） |
| `gateway/` | 评论网关（Node 服务，零依赖）：人机验证 + IP 限流 + 本地存储 |
| `assets/css/style.css` | 视觉系统，设计令牌在文件顶部 `:root` |
| `assets/js/main.js` | 动效：boot log 打字机、标题解码、滚动显现、数字滚动 |
| `assets/js/os-demo.js` | os.html 的模拟器控制：镜像探测 / 下载进度 / 启动 / 重启 / 全屏 |
| `assets/js/blog.js` | 博客页：文章渲染、迷你 Markdown、发布密码、评论区挂载 |
| `assets/js/comments.js` | 评论区前端：验证码模式探测、提交、渲染 |
| `assets/data/posts.json` | 文章基线数据（4 篇） |
| `assets/fonts/` | JetBrains Mono + Noto Sans SC，按页面分组子集化 |
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

## 评论网关（gateway/）

博客的评论区需要一个后端：GitHub Pages 是纯静态托管，做不了 IP 限流和验证码校验，所以评论功能由一个独立的 Node 服务承担。

**设计取舍**：不接云服务数据库、不用 GitHub Issues、不需要任何 token 或密钥。评论存在网关自己的 `data/comments.json` 里，落盘用「临时文件 + rename」保证原子性。

### 三个关键实现细节

1. **限流必须在服务端做。** 纯前端的 localStorage 限流形同虚场。规则是同 IP 10 秒最多 2 次，另有每小时 20 次兜底。
2. **限流表和验证码答案都要落盘。** 线上是多副本负载均衡，内存里的 Map 各副本互不可见——放在内存里等于没限流。读改写用同步 IO，避免两个请求读到同一份旧表后互相覆盖。
3. **客户端自带 captcha id。** 图片 URL 里带上 id，服务端按这个 id 存答案，保证「看到的图」和「提交的 id」是同一张验证码。

### 人机验证：双引擎

| 模式 | 条件 | 说明 |
| --- | --- | --- |
| Cloudflare Turnstile | 配置了 `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` | 免费无限量，服务端调 siteverify 校验，secret 永不下发 |
| 自研 PNG 点阵验证码 | 未配置密钥时自动退回 | 5×7 点阵字模 + 干扰线 + 噪点，答案只在服务端；图像里没有可解析字符，只能 OCR |

前端自动探测模式：`GET /api/captcha` 返回 `image/png` 就是本地模式，返回 JSON 就切到 Turnstile 挂件。

### 部署与配置

网关是独立于 GitHub Pages 的服务，需要单独部署：

```bash
cd gateway
node server.js          # 读 PORT 环境变量，默认 8787
```

环境变量（都不是必需，不配就退回本地验证码）：

```bash
PORT=8787
TURNSTILE_SITE_KEY=...   # Cloudflare 控制台创建 Turnstile widget 得到
TURNSTILE_SECRET_KEY=...
```

部署时前端要拿到网关地址和访问码，改 `assets/js/comments.js` 顶部：

```js
var SHARE_CODE = "OBVHYSCDUX";
var GATEWAY = "https://pen-pig-comment-gateway.app.workbuddy.host";
```

### 数据备份（重要）

**重新部署网关会覆盖线上的 `data/` 目录**，也就是「重新部署 = 清空线上评论」。所以每次重新部署前先拉一份回来：

```bash
python gateway/backup.py pull    # 线上 -> 本地 data/comments.json
# ... 重新部署 ...
```

`python gateway/backup.py show` 可以同时看线上和本地各有多少条。

### 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 + 当前评论数 + 验证码模式 |
| GET | `/api/captcha` | 签发验证码（本地模式返回 PNG + `X-Captcha-Id` 头） |
| GET | `/api/comments?post=<id>` | 读取某篇文章的评论 |
| GET | `/api/comments/export` | 全量导出（备份用） |
| POST | `/api/comments` | 提交评论 |

## 本地预览

直接双击 `index.html`，或起一个本地服务：

```bash
python -m http.server 8000   # 然后打开 http://localhost:8000
```

评论功能需要网关一起跑。本地调试时在网址后加 `?local=1`，前端会指向 `http://127.0.0.1:8791`：

```bash
cd gateway && PORT=8791 node server.js
```

> 注意：本地验证 os.html 时镜像用 buffer 模式加载，不受服务器 Range 支持影响；线上（GitHub Pages CDN）两种模式都可用。

## 修改指南

- **改文案 / 链接**：编辑 `index.html`
- **改配色**：编辑 `style.css` 顶部 `:root` 中的 CSS 变量（`--accent` 磷光绿，`--amber` 琥珀）
- **加了新文字后**：页面用到的字符已固化进 `assets/fonts/` 的子集，新字符会回退到系统字体；如需重新生成子集，用 `pyftsubset` 以页面全部可见字符为 `--text-file` 重新裁剪即可
- **动效**：全部尊重 `prefers-reduced-motion`；关闭动效的用户会看到完整静态内容

## 部署

推送到 `main` → GitHub Actions（`.github/workflows/jekyll-gh-pages.yml`）自动构建 → Pages 发布，约 1 分钟。

> 本机到 github.com 的 HTTPS 被网络层阻断，SSH（22 端口）畅通，推送用：
> `git push git@github.com:pen-pig/pen-pig.github.io.git main`

## 说明

本站展示的项目（CeruliaOS、website、gdgzoi-clawler）代码由 AI 生成，由我负责需求、设计与验证。
