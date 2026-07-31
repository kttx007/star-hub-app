# Agnes AI 生图 / 生视频集成

三条使用路径，共用 `src/lib/agnes.js` 一份客户端逻辑：Dashboard 界面、命令行、Claude Code skill。

## 1. 配置 API Key

在 <https://platform.agnes-ai.com/settings/apiKeys> 创建，然后三选一：

| 场景 | 方式 | Key 存在哪 |
|---|---|---|
| 浏览器用 Dashboard | 「创意工坊」页顶部的设置面板 | 本机 localStorage，不入库、不进 bundle |
| 命令行 / Claude Code 会话 | `export AGNES_API_KEY=sk-xxx` 或写进 `.env` | 环境变量；`.env` 已 gitignore |
| 本地 dev 免手填 | `.env` 里设 `VITE_AGNES_API_KEY` | ⚠️ 见下方警告 |

> **⚠️ 不要给 `VITE_AGNES_API_KEY` 用于对外部署。** Vite 会把 `VITE_` 开头的变量在 `vite build` 时内联进静态产物，任何人都能从 bundle 里读出来，然后拿你的配额刷图。对外部署请用 localStorage 方案（BYOK），或加一层服务端代理。

## 2. Dashboard 界面

```bash
npm install
npm run dev     # 打开后切到「创意工坊」标签
```

- **生图**：文生图 / 图生图，可选模型与尺寸，结果可预览下载
- **生视频**：文生视频 / 图生视频（首帧），异步轮询带进度与取消

开发态请求走 `vite.config.js` 里的 `/agnes-api` 代理转发到 `apihub.agnes-ai.com`，绕开浏览器 CORS 限制。生产态直连，若目标站点未放开 CORS，需自行加服务端代理。

## 3. 命令行

```bash
npm run agnes:image -- "一只在沙滩上散步的猫" --size 1024x768
npm run agnes:video -- "电影感镜头：猫走过沙滩" --size 横屏
npm run agnes:image -- "换成夜景" --image ./ref.png    # 图生图
node scripts/agnes.mjs help
```

产物存到 `output/`（已 gitignore）。本地图片以 base64 data URI 直接进请求体，**不经过任何第三方图床**。

## 4. Claude Code Skill

已装在 `.agents/skills/agnes-ai-skill`（`.claude/skills/` 下有符号链接）。本地机器单独装用：

```bash
npx skills add jomeswang/agnes-ai-skill -g
```

### ⚠️ 使用前须知：这个第三方 skill 有两个副作用

1. **本地图片会被公开到互联网。** `scripts/agnes-media-url.sh` 在处理图生图/图生视频时，把本地文件上传到 [Litterbox](https://litterbox.catbox.moe)（匿名公开图床）换取临时 URL。SKILL.md 第 474-475 行还指示 agent 默认走这条路。产品设计稿、客户资料、私人照片一旦经手就是不可逆的公开暴露。
   **要处理敏感图片，请改用 `scripts/agnes.mjs`**，它走 base64 不做外传。

2. **会把 API Key 明文写进 shell rc 文件。** SKILL.md 第 149-177 行会检测 shell 并向 `~/.zshrc` / `~/.bashrc` 追加 `export AGNES_API_KEY=...`。

skill 自带 25MB 演示素材，已在 `.gitignore` 中排除，不影响功能。

## 5. 接口与配额

| 项 | 值 |
|---|---|
| Base URL | `https://apihub.agnes-ai.com` |
| 认证 | `Authorization: Bearer <key>` |
| 生图 | `POST /v1/images/generations` · `agnes-image-2.1-flash` / `agnes-image-2.0-flash` |
| 建视频任务 | `POST /v1/videos` · `agnes-video-v2.0` → 返回 `videoId` |
| 轮询 | `GET /agnesapi?video_id={videoId}` |
| 限速 | 文本 1000 RPM，视频 5 RPM（故轮询间隔设为 12s） |
| 视频配额 | 500 秒/天 |

接口兼容 OpenAI 风格。

> 这些字段是从公开文档和社区仓库整理的——官方 `/en/docs/agnes-video-v20` 返回 403 抓不到。`src/lib/agnes.js` 因此对响应做了多字段名兼容解析，取不到值会抛出带原始响应体的错误便于定位。若官方接口有变，改 `pick()` 的候选字段列表即可。
