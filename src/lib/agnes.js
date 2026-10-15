/**
 * Agnes AI 客户端 —— 框架无关，浏览器与 Node 共用。
 *
 * 模型目录与参数形态集中在 MODELS 里。Agnes 迭代很快（2.0 → 2.1 → 2.5 期间
 * 参数结构整个换过一轮），所以版本变动应该只改这张表，不动下面的逻辑。
 *
 * 字段依据公开文档整理。注意：本仓库所在的云端环境无法访问 agnes-ai.com
 * （网络策略拦截），因此以下字段未经真实调用验证。每个请求都支持 extraBody
 * 透传，字段名有出入时不必改库。
 */

export const DEFAULT_BASE_URL = 'https://apihub.agnes-ai.com';

/** 生图：2.5 用档位 size + ratio；2.x 旧版用像素 size。 */
export const IMAGE_MODELS = {
  'agnes-image-2.5-flash': {
    label: '2.5 Flash · 当前主力，档位尺寸 1K–4K',
    sizes: ['1K', '2K', '3K', '4K'],
    ratios: ['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9'],
    defaultSize: '2K',
    defaultRatio: '16:9',
  },
  'agnes-image-2.1-flash': {
    label: '2.1 Flash · 旧版，像素尺寸',
    legacy: true,
    sizes: ['1024x1024', '1024x768', '768x1024', '1280x720', '720x1280'],
    defaultSize: '1024x1024',
  },
  'agnes-image-2.0-flash': {
    label: '2.0 Flash · 旧版，重编辑/多图合成',
    legacy: true,
    sizes: ['1024x1024', '1024x768', '768x1024'],
    defaultSize: '1024x1024',
  },
};

/** 视频：2.5 用 mode/seconds/size/aspect_ratio；v2.0 旧版用 width/height。 */
export const VIDEO_MODELS = {
  'agnes-video-2.5': {
    label: '2.5 标准 · 最高 2K，支持视频参考',
    sizes: ['720P', '1080P', '1K', '2K'],
    defaultSize: '720P',
    maxImages: 5,
    videoRef: true,
  },
  'agnes-video-2.5-flash': {
    label: '2.5 Flash · 锁定 720P，最快',
    sizes: ['720P'], // 传其他值服务端返回 HTTP 400
    defaultSize: '720P',
    maxImages: 5,
    maxAudio: 3,
    videoRef: false,
  },
  'agnes-video-v2.0': {
    label: 'V2.0 · 旧版，像素宽高',
    legacy: true,
    defaultWidth: 1152,
    defaultHeight: 768,
  },
};

export const DEFAULT_IMAGE_MODEL = 'agnes-image-2.5-flash';
export const DEFAULT_VIDEO_MODEL = 'agnes-video-2.5-flash';

export const VIDEO_MODES = ['text', 'keyframe', 'reference'];
export const VIDEO_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'];

/** seconds 是字符串，范围 "4"–"12"，默认 "5"。 */
export const VIDEO_SECONDS_MIN = 4;
export const VIDEO_SECONDS_MAX = 12;
export const VIDEO_SECONDS_DEFAULT = '5';

/** 2.5 文档建议 1–2s 轮询一次。 */
export const POLL_INTERVAL_MS = 2_000;
export const POLL_TIMEOUT_MS = 10 * 60 * 1000;

/** 队列满（503 video_queue_full）时的重试策略，官方建议自动重试。 */
export const QUEUE_RETRY_MAX = 5;
export const QUEUE_RETRY_BASE_MS = 5_000;

export class AgnesError extends Error {
  constructor(message, { status, code, body, retryable = false } = {}) {
    super(message);
    this.name = 'AgnesError';
    this.status = status;
    this.code = code;
    this.body = body;
    this.retryable = retryable;
  }
}

/** 在任意深度找第一个非空候选字段，兼容响应结构变动。 */
function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      const found = pick(value, keys);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

const SUCCESS_STATES = ['succeeded', 'success', 'completed', 'complete', 'done', 'finished'];
const FAILURE_STATES = ['failed', 'failure', 'error', 'cancelled', 'canceled', 'rejected'];

function normalizeState(raw) {
  const state = String(raw ?? '').toLowerCase();
  if (SUCCESS_STATES.includes(state)) return 'succeeded';
  if (FAILURE_STATES.includes(state)) return 'failed';
  return 'pending';
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new AgnesError('已取消')); },
      { once: true });
  });

export function createAgnesClient({ apiKey, baseUrl = DEFAULT_BASE_URL, fetchImpl } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new AgnesError('当前环境没有可用的 fetch，请传入 fetchImpl');
  }

  const root = String(baseUrl).replace(/\/+$/, '').replace(/\/v1$/, '');

  async function request(path, { method = 'POST', body, signal } = {}) {
    if (!apiKey) throw new AgnesError('缺少 API Key');

    let response;
    try {
      response = await doFetch(`${root}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal,
      });
    } catch (cause) {
      if (cause instanceof AgnesError) throw cause;
      throw new AgnesError(
        `网络请求失败：${cause.message}。浏览器直连可能是 CORS 被拒 —— 改走 ` +
          `npm run dev 的 /agnes-api 代理；云端/受限网络需放行 apihub.agnes-ai.com。`,
        { body: String(cause) },
      );
    }

    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }

    if (!response.ok) {
      const code = pick(payload, ['code', 'error_code', 'errorCode']);
      const detail = pick(payload, ['message', 'error', 'detail', 'msg']) || text.slice(0, 300);
      // 503 video_queue_full / 429 限流都是可重试的瞬时状态。
      const retryable =
        response.status === 503 || response.status === 429 || code === 'video_queue_full';
      throw new AgnesError(`HTTP ${response.status}${code ? ` (${code})` : ''}: ${detail}`, {
        status: response.status,
        code,
        body: payload,
        retryable,
      });
    }
    return payload;
  }

  /** 列出网关实际可调用的模型。版本变动时用它核对，别信文档。 */
  async function listModels({ signal } = {}) {
    const raw = await request('/v1/models', { method: 'GET', signal });
    const items = raw?.data ?? raw?.models ?? [];
    return { ids: items.map((m) => m?.id ?? m?.name).filter(Boolean), raw };
  }

  /**
   * 文生图 / 图生图。
   * @param {string} [initImage] data URI 或图片 URL
   * @param {object} [extraBody] 透传到 extra_body，字段名有变动时的逃生口
   */
  async function generateImage({
    prompt,
    model = DEFAULT_IMAGE_MODEL,
    size,
    ratio,
    initImage,
    extraBody,
    signal,
  }) {
    if (!prompt?.trim()) throw new AgnesError('prompt 不能为空');

    const spec = IMAGE_MODELS[model] ?? {};
    const body = { model, prompt, size: size ?? spec.defaultSize };

    // ratio 只对档位式 size 的新模型有效。
    if (spec.ratios) body.ratio = ratio ?? spec.defaultRatio;

    // response_format 放顶层会报错，必须进 extra_body。
    const extra = { ...extraBody };
    if (initImage) extra.image = initImage;
    if (initImage && extra.response_format === undefined) extra.response_format = 'url';
    if (Object.keys(extra).length) body.extra_body = extra;

    const raw = await request('/v1/images/generations', { body, signal });

    const url = pick(raw, ['url', 'image_url', 'imageUrl']);
    const b64 = pick(raw, ['b64_json', 'b64', 'base64']);
    if (!url && !b64) throw new AgnesError('响应里没找到图片地址', { body: raw });
    return { url, b64, raw };
  }

  /** 创建视频任务。队列满时按指数退避自动重试。 */
  async function createVideo({
    prompt,
    model = DEFAULT_VIDEO_MODEL,
    mode = 'text',
    seconds = VIDEO_SECONDS_DEFAULT,
    size,
    aspectRatio = '16:9',
    images,
    extraBody,
    signal,
    onRetry,
  }) {
    if (!prompt?.trim()) throw new AgnesError('prompt 不能为空');
    if (!VIDEO_MODES.includes(mode)) throw new AgnesError(`mode 必须是 ${VIDEO_MODES.join('/')}`);

    const spec = VIDEO_MODELS[model] ?? {};
    const body = { model, prompt };

    if (spec.legacy) {
      // v2.0 旧参数形态
      body.width = spec.defaultWidth;
      body.height = spec.defaultHeight;
    } else {
      const n = Number(seconds);
      if (!Number.isFinite(n) || n < VIDEO_SECONDS_MIN || n > VIDEO_SECONDS_MAX) {
        throw new AgnesError(`seconds 需在 ${VIDEO_SECONDS_MIN}–${VIDEO_SECONDS_MAX} 之间`);
      }
      body.mode = mode;
      body.seconds = String(n); // 文档写明是字符串
      body.size = size ?? spec.defaultSize;
      body.aspect_ratio = aspectRatio;

      if (spec.sizes && !spec.sizes.includes(body.size)) {
        throw new AgnesError(
          `${model} 只支持 size=${spec.sizes.join('/')}，传其他值服务端会返回 400`,
        );
      }
    }

    const refs = images ? (Array.isArray(images) ? images : [images]) : [];
    if (refs.length) {
      if (spec.maxImages && refs.length > spec.maxImages) {
        throw new AgnesError(`${model} 最多 ${spec.maxImages} 张参考图，收到 ${refs.length} 张`);
      }
      // 字段名未经真实调用验证；若服务端报错，用 extraBody 覆盖。
      if (spec.legacy) body.image = refs[0];
      else body.images = refs;
    }

    if (extraBody) Object.assign(body, extraBody);

    let lastError;
    for (let attempt = 0; attempt <= QUEUE_RETRY_MAX; attempt++) {
      try {
        const raw = await request('/v1/videos', { body, signal });
        const videoId = pick(raw, ['videoId', 'video_id']);
        const taskId = pick(raw, ['taskId', 'task_id', 'id']);
        const id = videoId || taskId;
        if (!id) throw new AgnesError('响应里没找到 videoId / taskId', { body: raw });
        return { id, videoId, taskId, model, raw };
      } catch (error) {
        lastError = error;
        if (!error.retryable || attempt === QUEUE_RETRY_MAX) throw error;
        const waitMs = QUEUE_RETRY_BASE_MS * 2 ** attempt;
        onRetry?.({ attempt: attempt + 1, waitMs, reason: error.message });
        await sleep(waitMs, signal);
      }
    }
    throw lastError;
  }

  /** 查一次任务状态。2.5 需要带 model_name。 */
  async function pollVideoOnce(videoId, { model, signal } = {}) {
    const params = new URLSearchParams({ video_id: videoId });
    if (model) params.set('model_name', model);
    const raw = await request(`/agnesapi?${params}`, { method: 'GET', signal });

    const state = normalizeState(pick(raw, ['status', 'state', 'taskStatus', 'task_status']));
    const url = pick(raw, ['video_url', 'videoUrl', 'url', 'download_url', 'downloadUrl']);

    // 有些响应不带 status，完成时只给 url。
    if (url && state !== 'failed') return { state: 'succeeded', url, raw };
    if (state === 'failed') {
      const reason = pick(raw, ['message', 'error', 'reason', 'failReason']) || '未知原因';
      throw new AgnesError(`视频生成失败：${reason}`, { body: raw });
    }
    return { state, url, raw };
  }

  /** 创建 + 轮询到出片。 */
  async function generateVideo({ onProgress, onRetry, signal, ...params }) {
    const { id, model } = await createVideo({ ...params, signal, onRetry });
    const startedAt = Date.now();

    while (true) {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        throw new AgnesError(
          `轮询超时（${Math.round(POLL_TIMEOUT_MS / 60000)} 分钟）。任务可能仍在跑，videoId=${id}`,
        );
      }
      await sleep(POLL_INTERVAL_MS, signal);

      let result;
      try {
        result = await pollVideoOnce(id, { model, signal });
      } catch (error) {
        if (error.retryable) continue; // 轮询时限流就下一轮再查
        throw error;
      }
      onProgress?.({ elapsedMs: Date.now() - startedAt, state: result.state, id });
      if (result.state === 'succeeded') return { ...result, id, model };
    }
  }

  return { listModels, generateImage, createVideo, pollVideoOnce, generateVideo };
}
