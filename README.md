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
| `gateway/` | 网关（Node 服务，只用标准库）：人机验证 + IP 限流 + 本地存储 + 博客发布接口；`hashpass.js` 生成发布密码的哈希 |
| `assets/css/style.css` | 视觉系统，设计令牌在文件顶部 `:root` |
| `assets/js/main.js` | 动效：boot log 打字机、标题解码、滚动显现、数字滚动 |
| `assets/js/os-demo.js` | os.html 的模拟器控制：镜像探测 / 下载进度 / 启动 / 重启 / 全屏 |
| `assets/js/blog.js` | 博客页：文章渲染、迷你 Markdown、发布密码校验、发布/删除、评论区挂载 |
| `assets/js/comments.js` | 评论区前端：验证码、提交、渲染、楼中楼回复、删除码 |
| `assets/data/posts.json` | 文章快照（网关不可用时的退路；线上正式内容在网关的 `data/posts.json`） |
| `assets/fonts/` | JetBrains Mono + Noto Sans SC，按页面分组子集化 |
| `assets/v86/` | v86 模拟器：`libv86.js` + `v86.wasm` + `bios/`（seabios / vgabios） |
| `assets/os/cerulia.img` | CeruliaOS 磁盘镜像（约 0.8MB，来自 `tools/make_image.py` 的 `os-image.bin`） |
| `.nojekyll` | 纯静态站点，跳过 Jekyll 处理 |

## 博客发布

文章正文存在网关自己的 `gateway/data/posts.json` 里，页面优先读网关；网关不可用时才回退到仓库里的 `assets/data/posts.json` 快照。

发布流程：

1. 点「解锁编辑」输入密码。浏览器按下面的算法算哈希、和 `assets/js/blog.js` 里存的值比对，同时把密码发给网关校验一次——网关也只存哈希，不存明文，校验通过就签一个临时令牌（2 小时）。
2. 写完文章点「发布上线」，填一次人机验证（GD 风格的 4 位小写字符图）。网关校验令牌 + 验证码后写回文章库，所有访客立刻能看到。
3. 「存草稿」只写在这台浏览器的 localStorage，不上线；删除文章同样要过验证码。

密码**不以明文形式存在于任何源码里**。`assets/js/blog.js` 只存「盐 + 迭代次数 + 哈希」三件套，解锁时在浏览器里算哈希后比对：

```
H0 = SHA256(salt || password)
Hi+1 = SHA256(Hi)      重复 iterations 次
```

盐是随机生成的，迭代次数 10000，比对用常数时间实现。

优先走 `crypto.subtle`（WebCrypto）；页面不在安全上下文（没有 HTTPS / 不是 localhost）时自动退回内置的纯 JS SHA-256 实现，两条路径算法完全一致、结果相同。

输入的密码会先做归一化再算哈希：全角 ASCII 转半角、全角空格转半角、去掉首尾空白。中文输入法会把 `!` `#` `~` 之类打成全角，复制粘贴又会带上首尾空白，不归一化的话算出来的哈希对不上。前端 `assets/js/blog.js` 的 `normalizePassword` 和网关 `gateway/server.js` 的同名函数是同一套规则，两边必须保持一致。

### 改密码

```bash
node gateway/hashpass.js "新密码"
```

输出的 JSON 要贴到两处：`assets/js/blog.js` 的 `BLOG_AUTH`（浏览器本地比对）和 `gateway/server.js` 的 `PUBLISH_AUTH`（网关校验）。脚本会打印自检结果（正确密码匹配、错误密码不匹配）。

改完 `assets/js/blog.js` 记得把 `blog.html` 里的引用版本号往上提一位（`blog.js?v=N`），否则浏览器和 CDN 会继续用旧的那份。

> 密码只在解锁时通过 HTTPS 发给网关一次；源码和网关配置里都只有哈希。

## 浏览器运行 CeruliaOS（os.html）

`os.html` 用 [v86](https://copy.sh/v86/)（WebAssembly x86 模拟器）在网页里启动真实的 CeruliaOS 磁盘镜像，走完整的 BIOS → MBR → boot sector → stage2 → kernel 引导链。屏幕上的每个字符都是模拟器现场执行机器码的输出。

实现上几个要注意的地方：

- 本版 v86 的 `v86.wasm` 不内置 BIOS，`seabios.bin` / `vgabios.bin` 必须显式配置（已托管在 `assets/v86/bios/`）
- 镜像用 `fetch` 整块下载（带进度条）后以 buffer 模式挂到 hda；不用 v86 的 async 分块，几 MB 一次加载更稳
- 新版 v86 构造后由 `autostart: true` 自动启动，不能手动调 `run()`（内部 core 未就绪会抛 TypeError）

### 更新镜像

在 CeruliaOS 源码目录构建后，把 legacy 引导镜像放到本站：

```bash
python tools/make_image.py                  # 生成 os-image.bin（引导扇区 + stage2 + 内核，约 0.8MB）
cp os-image.bin <本站>/assets/os/cerulia.img
```

`os-image.bin` 无数据分区，因此浏览器版里文件系统相关命令不可用（shell、selftest 等内核功能完整）。

## 评论网关（gateway/）

博客的评论区需要一个后端：GitHub Pages 是纯静态托管，做不了 IP 限流和验证码校验，所以评论功能由一个独立的 Node 服务承担。

存储：评论存在网关自己的 `data/comments.json` 里，落盘用「临时文件 + rename」保证原子性。不接云服务数据库、不用 GitHub Issues、不需要任何 token 或密钥。

### 评论区

评论区按社团网站的讨论区模型实现（forum.php / post.php）：

| 能力 | 说明 |
| --- | --- |
| 楼号 | 每条评论一个 `#N 楼`，由服务端在创建时按本文顺序固定 |
| 楼中楼 | 点「回复」进入回复态，回复挂在目标楼下面缩进显示，可取消 |
| 头像 | 昵称首字圆头像，颜色按昵称哈希固定（同一昵称同一颜色） |
| 配图 | 单张 jpg / png / gif / webp，≤2MB，服务端按魔数校验真实类型，存 `data/uploads/` |
| 删自己的评论 | 匿名没有账号体系，所以用「删除码」代替密码：提交时服务端随机生成明文只回给提交者一次，库里只留 SHA-256 哈希，之后凭删除码删掉自己那条 |

配图文件名走白名单正则（`img_<16位hex>.<ext>`）+ `realpath` 校验，路径穿越直接 400。

### 实现说明

1. 限流在服务端做。规则是同 IP 10 秒最多 2 次，另有每小时 20 次兜底（阈值可用 `RATE_WINDOW_MAX` / `RATE_HOUR_MAX` 覆盖，方便联调）。
2. 限流表和验证码答案落盘。线上是多副本负载均衡，内存里的 Map 各副本互不可见。读改写用同步 IO，避免两个请求读到同一份旧表后互相覆盖。
3. 验证码由客户端自带 id。图片 URL 里带上 id，服务端按这个 id 存答案，保证「看到的图」和「提交的 id」是同一张。

### 人机验证

GD 风格的字符验证码：4 位小写字符（字符表去掉容易看混的 0 o 1 l i），带干扰弧线和噪点，逐字符随机抖动和随机颜色。

- 图片由手写 PNG 编码器直接生成（字符用 5×7 点阵画出来，2 倍超采样后缩回，边缘平滑），网关只用 Node 标准库，不装 GD 也不装图形库。
- 答案只存服务端；客户端自带 id 放进图片 URL，服务端按这个 id 存答案，保证「看到的图」和「提交的 id」是同一张。校验后立即作废。
- 线上是多副本负载均衡，答案落盘（`data/captcha.json`），各副本共用。

### 部署与配置

网关是独立于 GitHub Pages 的服务，需要单独部署：

```bash
cd gateway
node server.js          # 读 PORT 环境变量，默认 8787
```

环境变量（都不是必需）：

```bash
PORT=8787
RATE_WINDOW_MAX=2        # 评论限流：10 秒内最多几次
RATE_HOUR_MAX=20         # 评论限流：每小时最多几次
PUB_WINDOW_MAX=6         # 发布限流：10 秒内最多几次
PUB_HOUR_MAX=60          # 发布限流：每小时最多几次
BLOG_PW_SALT=...         # 发布密码参数（默认写死在 server.js 里）
BLOG_PW_HASH=...
BLOG_PW_ITERATIONS=10000
```

部署时前端要拿到网关地址和访问码，改 `assets/js/comments.js` 和 `assets/js/blog.js` 顶部：

```js
var SHARE_CODE = "OBVHYSCDUX";
var GATEWAY = "https://pen-pig-comment-gateway.app.workbuddy.host";
```

### 数据备份

重新部署网关会覆盖线上的 `data/` 目录，也就是「重新部署 = 清空线上评论和文章」。所以每次重新部署前先拉一份回来：

```bash
python gateway/backup.py pull    # 线上 -> 本地 data/comments.json + data/uploads/ 配图
# ... 重新部署 ...
```

`python gateway/backup.py show` 可以同时看线上和本地各有多少条。

> 备份只存公开字段，删除码的哈希不进备份，所以重新部署后旧评论的删除码会失效（旧评论没有删除码机制，本来也无法自助删除）。

### 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 + 当前评论数 + 验证码模式 |
| GET | `/api/captcha` | 签发验证码（返回 PNG + `X-Captcha-Id` 头） |
| GET | `/api/comments?post=<id>` | 读取某篇文章的评论 |
| GET | `/api/comments/export` | 全量导出（备份用，含配图文件清单） |
| GET | `/api/image?file=<name>` | 读取评论配图 |
| POST | `/api/comments` | 提交评论（支持 `replyTo` 回复某楼、`image` 配图；返回一次性 `delKey`） |
| POST | `/api/comments/delete` | 用删除码删掉自己那条（`{id, delKey}`） |
| GET | `/api/posts` | 读取文章列表 |
| POST | `/api/publish/token` | 用发布密码换临时令牌（`{password}`） |
| POST | `/api/posts` | 发布/覆盖一篇文章（`{token \| password, captchaId, captchaAnswer, post}`） |
| POST | `/api/posts/delete` | 删掉一篇文章（`{token \| password, captchaId, captchaAnswer, id}`） |

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
