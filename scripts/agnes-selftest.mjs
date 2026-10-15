#!/usr/bin/env node
/**
 * 自检：用本地 stub server 验证客户端逻辑，不碰真实 API。
 *
 *   node scripts/agnes-selftest.mjs
 *
 * 验证内容：请求体字段形态、response_format 的位置、seconds 的字符串类型、
 * 轮询 query 带 model_name、503 video_queue_full 自动重试、参数校验与错误路径。
 *
 * 它不能验证真实服务端是否接受这些字段 —— 那需要一次带 key 的真实调用。
 */

import { createServer } from 'node:http';
import assert from 'node:assert/strict';

import {
  createAgnesClient,
  AgnesError,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
} from '../src/lib/agnes.js';

const requests = [];
let queueFullRemaining = 0;
let pollsRemaining = 0;

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : null;
    requests.push({ path: url.pathname, query: url.searchParams, body, headers: req.headers });
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };

    if (url.pathname === '/v1/models') {
      return send(200, { data: [{ id: 'agnes-image-2.5-flash' }, { id: 'agnes-video-2.5-flash' }] });
    }
    if (url.pathname === '/v1/images/generations') {
      return send(200, { data: [{ url: 'https://stub.test/out.png' }] });
    }
    if (url.pathname === '/v1/videos') {
      if (queueFullRemaining > 0) {
        queueFullRemaining--;
        return send(503, { code: 'video_queue_full', message: 'video queue is full, please retry later' });
      }
      return send(200, { video_id: 'vid_stub_1', task_id: 'task_stub_1' });
    }
    if (url.pathname === '/agnesapi') {
      if (pollsRemaining > 0) {
        pollsRemaining--;
        return send(200, { status: 'processing' });
      }
      return send(200, { status: 'completed', url: 'https://stub.test/out.mp4' });
    }
    send(404, { message: 'not found' });
  });
});

const PASS = [];
const FAIL = [];
function check(name, fn) {
  try { fn(); PASS.push(name); }
  catch (e) { FAIL.push(`${name}\n    ${e.message}`); }
}

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

// 本地回环不该走代理，否则 stub 收不到请求。
const client = createAgnesClient({ apiKey: 'sk-test-key', baseUrl });

try {
  // ---- 1. 模型发现 ----
  const models = await client.listModels();
  check('listModels 解析 data[].id', () => {
    assert.deepEqual(models.ids, ['agnes-image-2.5-flash', 'agnes-video-2.5-flash']);
  });
  check('请求带 Bearer 认证头', () => {
    assert.equal(requests.at(-1).headers.authorization, 'Bearer sk-test-key');
  });

  // ---- 2. 生图：档位 size + ratio ----
  requests.length = 0;
  await client.generateImage({ prompt: '一只猫', size: '2K', ratio: '16:9' });
  const imgReq = requests.at(-1);
  check('生图命中 /v1/images/generations', () => assert.equal(imgReq.path, '/v1/images/generations'));
  check('生图默认模型是 2.5-flash', () => assert.equal(imgReq.body.model, DEFAULT_IMAGE_MODEL));
  check('size 是档位值而非像素', () => assert.equal(imgReq.body.size, '2K'));
  check('ratio 正确传入', () => assert.equal(imgReq.body.ratio, '16:9'));
  check('无参考图时不带 extra_body', () => assert.equal(imgReq.body.extra_body, undefined));

  // ---- 3. 图生图：response_format 必须在 extra_body 而非顶层 ----
  requests.length = 0;
  await client.generateImage({ prompt: '改成夜景', initImage: 'data:image/png;base64,AAA' });
  const i2iReq = requests.at(-1);
  check('response_format 不在顶层', () => assert.equal(i2iReq.body.response_format, undefined));
  check('response_format 在 extra_body 内', () =>
    assert.equal(i2iReq.body.extra_body.response_format, 'url'));
  check('参考图进 extra_body.image', () =>
    assert.equal(i2iReq.body.extra_body.image, 'data:image/png;base64,AAA'));

  // ---- 4. 旧版模型仍走像素 size，且不带 ratio ----
  requests.length = 0;
  await client.generateImage({ prompt: 'x', model: 'agnes-image-2.1-flash' });
  check('旧版模型默认像素 size', () => assert.equal(requests.at(-1).body.size, '1024x1024'));
  check('旧版模型不带 ratio', () => assert.equal(requests.at(-1).body.ratio, undefined));

  // ---- 5. 生视频：mode/seconds/size/aspect_ratio ----
  requests.length = 0;
  pollsRemaining = 2;
  const vid = await client.generateVideo({ prompt: '猫走过沙滩', seconds: 8 });
  const vidReq = requests.find((r) => r.path === '/v1/videos');
  check('视频默认模型是 2.5-flash', () => assert.equal(vidReq.body.model, DEFAULT_VIDEO_MODEL));
  check('seconds 是字符串类型', () => assert.equal(vidReq.body.seconds, '8'));
  check('mode 默认 text', () => assert.equal(vidReq.body.mode, 'text'));
  check('size 用档位 720P', () => assert.equal(vidReq.body.size, '720P'));
  check('aspect_ratio 默认 16:9', () => assert.equal(vidReq.body.aspect_ratio, '16:9'));
  check('不再发送 width/height', () => {
    assert.equal(vidReq.body.width, undefined);
    assert.equal(vidReq.body.height, undefined);
  });

  // ---- 6. 轮询：带 video_id 与 model_name ----
  const pollReq = requests.filter((r) => r.path === '/agnesapi').at(-1);
  check('轮询带 video_id', () => assert.equal(pollReq.query.get('video_id'), 'vid_stub_1'));
  check('轮询带 model_name', () =>
    assert.equal(pollReq.query.get('model_name'), DEFAULT_VIDEO_MODEL));
  check('轮询到完成拿到 url', () => assert.equal(vid.url, 'https://stub.test/out.mp4'));
  check('中间态被正确识别为 pending', () =>
    assert.equal(requests.filter((r) => r.path === '/agnesapi').length, 3));

  // ---- 7. 503 video_queue_full 自动重试 ----
  requests.length = 0;
  queueFullRemaining = 2;
  pollsRemaining = 0;
  const retries = [];
  const retried = await client.generateVideo({
    prompt: '重试测试',
    onRetry: (info) => retries.push(info),
  });
  check('队列满后重试并最终成功', () => assert.equal(retried.url, 'https://stub.test/out.mp4'));
  check('重试了 2 次', () => assert.equal(retries.length, 2));
  check('退避时间递增', () => assert.ok(retries[1].waitMs > retries[0].waitMs));
  check('创建请求共发出 3 次', () =>
    assert.equal(requests.filter((r) => r.path === '/v1/videos').length, 3));

  // ---- 8. 参数校验 ----
  const rejects = async (name, fn, match) => {
    try { await fn(); FAIL.push(`${name}\n    应当抛错但没有`); }
    catch (e) {
      if (e instanceof AgnesError && e.message.includes(match)) PASS.push(name);
      else FAIL.push(`${name}\n    错误信息不符：${e.message}`);
    }
  };
  await rejects('空 prompt 被拒', () => client.generateImage({ prompt: '  ' }), 'prompt 不能为空');
  await rejects('seconds 越界被拒',
    () => client.createVideo({ prompt: 'x', seconds: 30 }), 'seconds 需在');
  await rejects('flash 传非 720P 被拒',
    () => client.createVideo({ prompt: 'x', size: '2K' }), '只支持 size=');
  await rejects('非法 mode 被拒',
    () => client.createVideo({ prompt: 'x', mode: 'bogus' }), 'mode 必须是');
  await rejects('参考图超限被拒',
    () => client.createVideo({ prompt: 'x', images: Array(6).fill('a') }), '最多 5 张');
  await rejects('缺 key 被拒',
    () => createAgnesClient({ baseUrl }).generateImage({ prompt: 'x' }), '缺少 API Key');

  // ---- 9. extraBody 逃生口 ----
  requests.length = 0;
  await client.createVideo({ prompt: 'x', extraBody: { images: ['https://a/b.png'], foo: 1 } });
  check('extraBody 透传并可覆盖字段', () => {
    assert.deepEqual(requests.at(-1).body.images, ['https://a/b.png']);
    assert.equal(requests.at(-1).body.foo, 1);
  });
} finally {
  server.close();
}

console.log(`\n通过 ${PASS.length} 项：`);
for (const p of PASS) console.log(`  ✓ ${p}`);
if (FAIL.length) {
  console.log(`\n失败 ${FAIL.length} 项：`);
  for (const f of FAIL) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('\n全部通过。注意：这只验证客户端逻辑，未验证真实服务端是否接受这些字段。\n');
