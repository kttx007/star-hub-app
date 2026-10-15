# Agnes AI 生图 / 生视频集成 —— 复现文档

> 给 muse 的复现说明。目标：在一个纯静态 Vite + React 前端里接入 Agnes AI 的生图与生视频能力，同时提供命令行入口，三条路径共用一份客户端逻辑。

**最后核对：2026-10-15。** Agnes 迭代很快（2.0 → 2.1 → 2.5 期间参数结构整个换过一轮），下面标注了哪些是已核实的、哪些是未验证的。

---

## 0. 诚实说明：什么被验证了，什么没有

| 项目 | 状态 |
|---|---|
| 客户端逻辑（请求体构造、轮询、重试、校验） | ✅ 已验证 —— `npm run agnes:selftest`，33 项断言全通过 |
| 前端构建 | ✅ 已验证 —— `npm run build` 通过 |
| **真实 API 调用** | ❌ **未验证** —— 见下 |

未做真实调用的原因：本集成是在 Claude Code 云端会话里完成的，该环境网络策略拦截 `agnes-ai.com` 整个域：

```
curl: (56) CONNECT tunnel failed, response 403
# 代理状态：{"kind":"connect_rejected","host":"apihub.agnes-ai.com:443",
#            "detail":"gateway answered 403 to CONNECT (policy denial)"}
```

连官方文档站也打不开（`ENOTFOUND www.agnes-ai.com` / `wiki.agnes-ai.com`），所以**下面的接口字段是从搜索引擎摘要与第三方仓库整理的二手信息**。代码为此做了两层防护：响应解析多字段名兼容、请求支持 `extraBody` 透传。字段名有出入时改配置或传 `extraBody`，不必改库。

**复现第一步应该是跑一次真实调用核对字段。**

---

## 1. 前置条件

### 1.1 API Key

在 <https://platform.agnes-ai.com/settings/apiKeys> 创建，设为 `AGNES_API_KEY`。

### 1.2 网络放行（受限环境才需要）

`apihub.agnes-ai.com` 不在常见默认白名单里。在 Claude Code 云端环境中需要：

1. claude.ai/code → 消息框**上方**那行的云朵图标（无设置页、无直达 URL）
2. **Add cloud environment**
3. **Network access** 选 `Custom`，**Allowed domains** 填：
   ```
   apihub.agnes-ai.com
   platform.agnes-ai.com
   ```
4. ✅ 勾 **Also include default list of common package managers**（不勾则 npm / GitHub 全断）
5. **Environment variables**（`.env` 格式）：`AGNES_API_KEY=sk-xxx`
6. 保存后**必须新开会话** —— 环境变量只在会话启动时拷贝一次，运行中的会话不会重读

> ⚠️ 官方文档明确说：cloud environments **没有** secrets 存储，环境变量是明文，使用该环境的人都能读。个人私有环境风险可接受，团队共享环境不要放凭据。

---

## 2. 接口事实

### 2.1 基础

| 项 | 值 |
|---|---|
| Base URL | `https://apihub.agnes-ai.com` |
| 认证 | `Authorization: Bearer <key>` |
| 风格 | OpenAI 兼容 |
| 模型清单 | `GET /v1/models` ← 未在文档中列出，但网关通常支持；用它核对真实可用模型 |

### 2.2 生图

`POST /v1/images/generations`

| 字段 | 说明 |
|---|---|
| `model` | **`agnes-image-2.5-flash`**（当前主力）/ `agnes-image-2.1-flash` / `agnes-image-2.0-flash` |
| `prompt` | 必填 |
| `size` | 2.5 用**档位**：`1K` `2K` `3K` `4K`；2.x 旧版用像素如 `1024x768` |
| `ratio` | 仅 2.5：`1:1`(默认) `3:4` `4:3` `16:9` `9:16` `2:3` `3:2` `21:9` |
| `extra_body.response_format` | **`response_format` 放顶层会报错，必须进 `extra_body`** |
| `extra_body.image` | 参考图（图生图） |

`size=2K` + `ratio=16:9` → 约 2624×1472。文档称所有档位与输入参考图当前免费。

### 2.3 生视频

创建：`POST /v1/videos`

| 字段 | 说明 |
|---|---|
| `model` | **`agnes-video-2.5-flash`**（锁 720P，最快）/ `agnes-video-2.5`（支持 720P/1080P/1K/2K + 视频参考）/ `agnes-video-v2.0`（旧版，用 `width`/`height`） |
| `prompt` | 必填 |
| `mode` | `text` / `keyframe` / `reference` |
| `seconds` | **字符串**，`"4"`–`"12"`，默认 `"5"` |
| `size` | 档位。**flash 传非 `720P` 会返回 HTTP 400** |
| `aspect_ratio` | 默认 `16:9` |

轮询：`GET /agnesapi?video_id=<id>&model_name=<model>`

- **注意路径在 `/v1` 之外**
- 2.5 要求带 `model_name`
- 文档建议 **1–2s** 轮询一次（旧版 v2.0 是 5 RPM 限速，节奏完全不同）
- 直到 `status` 为 `completed` / `failed`

**flash 限制**：最多 5 张参考图、3 段音频，不支持视频参考，单次只出 1 条。

### 2.4 已知坑

**HTTP 503 `video_queue_full`** —— 官方 issue [#142](https://github.com/AgnesAI-Labs/AgnesAI-Models/issues/142)：视频队列会满，返回 `{"code":"video_queue_full","message":"video queue is full, please retry later"}` 且**不返回 video_id**（无任务可轮询）。维护者回复「服务端队列容量目前有限」，建议**启用自动重试**。多个账号、新 key 都会遇到，不是账号问题。被拒请求是否计入配额，官方未说明。

**GitHub 上的 `AgnesAI-Labs/AgnesAI-Models` 模型目录是滞后的** —— 它只列到 `agnes-image-2.1-flash` / `agnes-video-v2.0`，而文档站已有 2.5 页面。**别拿那个 README 当权威**，用 `GET /v1/models` 核对。

---

## 3. 架构决策

### 3.1 为什么是 BYOK + localStorage

star-hub-app 是**纯静态 Vite SPA，没有后端**。关键约束：

> `import.meta.env.VITE_*` 在 `vite build` 时会被**内联进 JS bundle**。

所以把 key 放 `VITE_AGNES_API_KEY` 再对外部署 = 把 key 明文发布。方案对比：

| 方案 | key 位置 | 适用 |
|---|---|---|
| **BYOK + localStorage**（本项目采用） | 用户浏览器本地 | 自用 / 开源分发，零后端，静态托管即可 |
| Serverless 代理 | 服务端环境变量 | 对外开放，最安全，需绑定部署平台 |
| `VITE_` 环境变量 | **bundle 内，公开** | 仅 `npm run dev` 本机调试 |

验证手段：`grep -o 'sk-[A-Za-z0-9._-]*' dist/assets/*.js` 应只匹配到 UI 占位符 `sk-...`。

### 3.2 为什么客户端要框架无关

浏览器和 CLI 如果各写一份，接口变动时必然漂移（Agnes 已经证明它会变）。所以 `src/lib/agnes.js` 不 import 任何浏览器或 Node 专有 API，`fetch` 可注入，两端共用。

### 3.3 为什么模型目录是配置表

2.0 → 2.5 期间参数形态从 `width/height` 变成 `mode/seconds/size/aspect_ratio`。把每个模型的能力（支持的档位、参考图上限、是否旧版参数）写成 `IMAGE_MODELS` / `VIDEO_MODELS` 描述表，**版本变动只改表，逻辑不动**。

### 3.4 为什么开发态要代理

浏览器直连 `apihub.agnes-ai.com` 可能被 CORS 拒（服务端是否放开 CORS 未知）。`vite.config.js` 配 `/agnes-api` 代理，请求从 dev server 发出，不受同源策略约束。生产态直连，若被拒需自建服务端代理。

### 3.5 为什么不用第三方 skill 的图床桥

社区 skill `jomeswang/agnes-ai-skill` 的 `scripts/agnes-media-url.sh` 把本地图片 `curl` 上传到 **Litterbox（catbox.moe 匿名公开图床）**换临时 URL，SKILL.md 还指示 agent 默认走这条路。这意味着任何本地图片都被**不可逆地公开到互联网**。本项目改用 **base64 data URI 直接进请求体**，不经第三方。

该 skill 还会向 `~/.zshrc` / `~/.bashrc` 追加明文 `export AGNES_API_KEY=...`。

---

## 4. 文件清单

| 文件 | 职责 |
|---|---|
| `src/lib/agnes.js` | 核心客户端。模型目录表、请求构造、轮询、503 退避重试、多字段名兼容解析。框架无关 |
| `src/components/AgnesStudio.jsx` | 生图/生视频面板。BYOK 密钥管理、连通性检测、参数表单、进度与取消 |
| `src/Dashboard.jsx` | 原内容抽为 `Cockpit`，加顶部视图切换 |
| `vite.config.js` | `/agnes-api` 开发代理 |
| `scripts/agnes.mjs` | CLI：`models` / `image` / `video` |
| `scripts/agnes-selftest.mjs` | 本地 stub server 自检，33 项断言，不碰真实 API |
| `.gitignore` | **本仓库原本没有** —— 引入 `.env` 前必须先补 |
| `.env.example` | 配置说明 |

---

## 5. 复现步骤

```bash
# 1. 装依赖
npm install

# 2. 先跑自检，确认客户端逻辑完好（不需要 key，不联网）
npm run agnes:selftest

# 3. 配 key
cp .env.example .env && vi .env     # 填 AGNES_API_KEY

# 4. 【关键】核对真实可用模型，别信文档
npm run agnes:models
#    若输出的 ID 与 src/lib/agnes.js 的 MODELS 表不一致，脚本会提示哪些可能已下线

# 5. 真实生图
npm run agnes:image -- "一只在沙滩上散步的猫" --size 2K --ratio 16:9

# 6. 真实生视频
npm run agnes:video -- "电影感镜头：猫走过沙滩" --seconds 8

# 7. 图生图 / 图生视频
npm run agnes:image -- "改成夜景" --image ./ref.png
npm run agnes:video -- "镜头缓慢推进" --image ./ref.png

# 8. 界面
npm run dev          # 切到「创意工坊」→ 先点「连通性检测」
```

产物落在 `output/`（已 gitignore）。

### 字段报错时怎么改

不要改库。先用 `extraBody` 覆盖：

```js
await client.createVideo({
  prompt: '…',
  extraBody: { reference_images: [url] },   // 覆盖/新增任意顶层字段
});
```

确认正确后再回填到 `src/lib/agnes.js` 的 `MODELS` 表或请求构造里。

---

## 6. 验证清单

| 检查 | 命令 | 期望 |
|---|---|---|
| 客户端逻辑 | `npm run agnes:selftest` | 33 项全通过 |
| 构建 | `npm run build` | 成功 |
| key 未泄漏 | `grep -o 'sk-[A-Za-z0-9._-]*' dist/assets/*.js` | 只有 `sk-...` 占位符 |
| 真实连通 | `npm run agnes:models` | 列出模型 ID |
| 真实生图 | `npm run agnes:image -- "test"` | `output/` 下出现 png |
| 真实生视频 | `npm run agnes:video -- "test"` | `output/` 下出现 mp4 |

前三项已在本仓库验证通过，后三项待在能联网的环境执行。
