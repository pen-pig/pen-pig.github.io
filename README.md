# pen-pig.github.io

个人主页。深色「系统控制台」风格——首屏是一段会自己敲出来的 boot log 终端。

🔗 **https://pen-pig.github.io/**

## 结构

| 路径 | 职责 |
| --- | --- |
| `index.html` | 单页全部内容（关于 / 项目 / 竞赛 / 联系） |
| `assets/css/style.css` | 视觉系统，设计令牌在文件顶部 `:root` |
| `assets/js/main.js` | 动效：boot log 打字机、标题解码、滚动显现、数字滚动 |
| `assets/fonts/` | JetBrains Mono + Noto Sans SC，按页面用字子集化（共约 190KB，零外部依赖） |
| `.nojekyll` | 纯静态站点，跳过 Jekyll 处理 |

## 本地预览

直接双击 `index.html`，或起一个本地服务：

```bash
python -m http.server 8000   # 然后打开 http://localhost:8000
```

## 修改指南

- **改文案 / 链接**：编辑 `index.html`
- **改配色**：编辑 `style.css` 顶部 `:root` 中的 CSS 变量（`--accent` 磷光绿，`--amber` 琥珀）
- **加了新文字后**：页面用到的字符已固化进 `assets/fonts/` 的子集，新字符会回退到系统字体；如需重新生成子集，用 `pyftsubset` 以页面全部可见字符为 `--text-file` 重新裁剪即可
- **动效**：全部尊重 `prefers-reduced-motion`；关闭动效的用户会看到完整静态内容

## 部署

推送到 `main` → GitHub Actions（`.github/workflows/jekyll-gh-pages.yml`）自动构建 → Pages 发布，约 1 分钟。

## 说明

本站展示的项目（CeruliaOS、website、gdgzoi-clawler）代码由 AI 生成，由我负责需求、设计与验证。
