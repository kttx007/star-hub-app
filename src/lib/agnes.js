/**
 * Agnes AI 客户端 —— 框架无关，浏览器与 Node 共用。
 *
 * 接口细节来源于公开文档与社区 skill 仓库（官方 /en/docs 返回 403 无法直接抓取），
 * 因此响应解析全部做了多形态兼容：字段名换了也能取到值，取不到会抛出带原始
 * 响应体的错误，方便一眼定位，而不是静默返回 undefined。
 */

export const DEFAULT_BASE_URL = 'https://apihub.agnes-ai.com';

export const IMAGE_MODELS = [
  { id: 'agnes-image-2.1-flash', label: '2.1 Flash · 文生图/图生图，高密度排版' },
  { id: 'agnes-image-2.0-flash', label: '2.0 Flash · 重编辑、多图合成' },
];

export const VIDEO_MODEL = 'agnes-video-v2.0';

export const IMAGE_SIZES = ['1024x1024', '1024x768', '768x1024', '1280x720', '720x1280'];

export const VIDEO_SIZES = [
  { label: '横屏 1152x768', width: 1152, height: 768 },
  { label: '竖屏 768x1152', width: 768, height: 1152 },
  { label: '方形 960x960', width: 960, height: 960 },
];

/** 视频轮询：5 RPM 限速，间隔必须 >= 12s 才不会被限流打回。 */
export const VIDEO_POLL_INTERVAL_MS = 12_000;
export const VIDEO_POLL_TIMEOUT_MS = 10 * 60 * 1000;

class AgnesError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'AgnesError';
    this.status = status;
    this.body = body;
  }
}

/** 在任意深度的对象里找第一个非空的候选字段。响应结构变动时的兜底。 */
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

export function createAgnesClient({ apiKey, baseUrl = DEFAULT_BASE_URL, fetchImpl } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new AgnesError('当前环境没有可用的 fetch，请传入 fetchImpl');
  }

  const root = String(baseUrl).replace(/\/+$/, '').replace(/\/v1$/, '');

  async function request(path, { method = 'POST', body, signal } = {}) {
    if (!apiKey) throw new AgnesError('缺少 API Key，请先在设置里填写');

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
      // 浏览器直连时 CORS 被拒会以 TypeError 形式出现，这里给出可操作的提示。
      throw new AgnesError(
        `网络请求失败：${cause.message}。若在浏览器中直连，可能是 CORS 被拒 —— ` +
          `改用 npm run dev 的 /agnes-api 代理，或把请求放到服务端。`,
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
      const detail = pick(payload, ['message', 'error', 'detail', 'msg']) || text.slice(0, 300);
      throw new AgnesError(`HTTP ${response.status}: ${detail}`, {
        status: response.status,
        body: payload,
      });
    }
    return payload;
  }

  /**
   * 文生图 / 图生图。
   * @param {string} [initImage] base64 或图片 URL，传了就是图生图。
   * @returns {Promise<{url?: string, b64?: string, raw: object}>}
   */
  async function generateImage({
    prompt,
    model = IMAGE_MODELS[0].id,
    size = '1024x1024',
    initImage,
    signal,
  }) {
    if (!prompt?.trim()) throw new AgnesError('prompt 不能为空');

    const body = { model, prompt, size };
    if (initImage) {
      body.extra_body = { image: initImage, response_format: 'url' };
    }

    const raw = await request('/v1/images/generations', { body, signal });

    const url = pick(raw, ['url', 'image_url', 'imageUrl']);
    const b64 = pick(raw, ['b64_json', 'b64', 'base64']);
    if (!url && !b64) {
      throw new AgnesError('响应里没找到图片地址', { body: raw });
    }
    return { url, b64, raw };
  }

  /** 创建视频任务，返回用于轮询的 id。 */
  async function createVideo({
    prompt,
    model = VIDEO_MODEL,
    width = 1152,
    height = 768,
    initImage,
    signal,
  }) {
    if (!prompt?.trim()) throw new AgnesError('prompt 不能为空');

    const body = { model, prompt, width, height };
    if (initImage) body.image = initImage;

    const raw = await request('/v1/videos', { body, signal });

    // videoId 优先，taskId 是遗留兼容路径。
    const videoId = pick(raw, ['videoId', 'video_id']);
    const taskId = pick(raw, ['taskId', 'task_id', 'id']);
    const id = videoId || taskId;
    if (!id) throw new AgnesError('响应里没找到 videoId / taskId', { body: raw });

    return { id, videoId, taskId, raw };
  }

  /** 查一次视频任务状态。 */
  async function pollVideoOnce(videoId, { signal } = {}) {
    const raw = await request(`/agnesapi?video_id=${encodeURIComponent(videoId)}`, {
      method: 'GET',
      signal,
    });

    const state = normalizeState(pick(raw, ['status', 'state', 'taskStatus', 'task_status']));
    const url = pick(raw, ['video_url', 'videoUrl', 'url', 'download_url', 'downloadUrl']);

    // 有些实现不返回 status，只在完成时给出 url —— 有 url 即视为成功。
    if (url && state !== 'failed') return { state: 'succeeded', url, raw };

    if (state === 'failed') {
      const reason = pick(raw, ['message', 'error', 'reason', 'failReason']) || '未知原因';
      throw new AgnesError(`视频生成失败：${reason}`, { body: raw });
    }
    return { state, url, raw };
  }

  /**
   * 创建 + 轮询到出片的完整流程。
   * @param {(info: {elapsedMs: number, state: string}) => void} [onProgress]
   */
  async function generateVideo({ onProgress, signal, ...params }) {
    const { id } = await createVideo({ ...params, signal });
    const startedAt = Date.now();

    while (true) {
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs > VIDEO_POLL_TIMEOUT_MS) {
        throw new AgnesError(
          `轮询超时（${Math.round(VIDEO_POLL_TIMEOUT_MS / 60000)} 分钟）。任务可能仍在跑，videoId=${id}`,
        );
      }

      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, VIDEO_POLL_INTERVAL_MS);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new AgnesError('已取消'));
        }, { once: true });
      });

      const result = await pollVideoOnce(id, { signal });
      onProgress?.({ elapsedMs: Date.now() - startedAt, state: result.state });
      if (result.state === 'succeeded') return { ...result, id };
    }
  }

  return { generateImage, createVideo, pollVideoOnce, generateVideo };
}

export { AgnesError };
