#!/usr/bin/env node
/**
 * Agnes AI 命令行工具 —— 云端会话和本地终端通用。
 *
 *   node scripts/agnes.mjs models
 *   node scripts/agnes.mjs image "一只在沙滩上散步的猫" --size 2K --ratio 16:9
 *   node scripts/agnes.mjs video "电影感镜头：猫走过沙滩" --seconds 8
 *   node scripts/agnes.mjs video "..." --image ./ref.png     # reference 模式
 *
 * Key 读取顺序：环境变量 AGNES_API_KEY → 项目根目录 .env
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createAgnesClient,
  DEFAULT_BASE_URL,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
  IMAGE_MODELS,
  VIDEO_MODELS,
  VIDEO_SECONDS_DEFAULT,
} from '../src/lib/agnes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = path.join(ROOT, 'output');

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!existsSync(envPath)) return;
  try { process.loadEnvFile(envPath); } catch { /* 旧版 Node 无此 API，靠环境变量即可 */ }
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const positional = [];
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) {
      const key = rest[i].slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith('--')) { flags[key] = next; i++; }
      else flags[key] = true;
    } else positional.push(rest[i]);
  }
  return { command, prompt: positional.join(' '), flags };
}

const timestamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

async function saveFromUrl(url, filename) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}`);
  await mkdir(OUTPUT_DIR, { recursive: true });
  const target = path.join(OUTPUT_DIR, filename);
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
  return target;
}

/** 本地图片 → data URI。不经第三方图床。 */
async function toDataUri(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase() || 'png';
  const buffer = await readFile(filePath);
  return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${buffer.toString('base64')}`;
}

function usage() {
  console.log(`
Agnes AI CLI

  node scripts/agnes.mjs models
      列出网关实际可调用的模型（最轻的连通性检测）

  node scripts/agnes.mjs image <prompt> [--model <id>] [--size <档位>] [--ratio 16:9] [--image <路径>]
  node scripts/agnes.mjs video <prompt> [--model <id>] [--size 720P] [--seconds 4-12]
                                        [--ratio 16:9] [--image <路径>]

生图模型：
${Object.entries(IMAGE_MODELS)
  .map(([id, m]) => `  ${id.padEnd(24)} ${m.label}\n  ${''.padEnd(24)} size: ${m.sizes.join(' / ')}`)
  .join('\n')}

视频模型：
${Object.entries(VIDEO_MODELS)
  .map(([id, m]) => `  ${id.padEnd(24)} ${m.label}${m.sizes ? `\n  ${''.padEnd(24)} size: ${m.sizes.join(' / ')}` : ''}`)
  .join('\n')}

默认：生图 ${DEFAULT_IMAGE_MODEL}，生视频 ${DEFAULT_VIDEO_MODEL}
产物保存在 output/（已 gitignore）。
`);
}

async function main() {
  loadEnvFile();
  const { command, prompt, flags } = parseArgs(process.argv.slice(2));

  if (!command || flags.help || command === 'help') {
    usage();
    process.exit(command ? 0 : 1);
  }

  const apiKey = process.env.AGNES_API_KEY;
  if (!apiKey) {
    console.error('✗ 未找到 AGNES_API_KEY。\n  设置方式：export AGNES_API_KEY=sk-xxx  或写进项目根目录 .env');
    process.exit(1);
  }

  const client = createAgnesClient({
    apiKey,
    baseUrl: process.env.AGNES_BASE_URL || DEFAULT_BASE_URL,
  });

  if (command === 'models') {
    const { ids, raw } = await client.listModels();
    if (ids.length) {
      console.log('✓ 网关可调用模型：');
      for (const id of ids) console.log(`  ${id}`);
      const stale = ids.length
        ? [...Object.keys(IMAGE_MODELS), ...Object.keys(VIDEO_MODELS)].filter((m) => !ids.includes(m))
        : [];
      if (stale.length) {
        console.log('\n⚠ 本地 MODELS 表里这些 ID 网关没返回，可能已下线：');
        for (const id of stale) console.log(`  ${id}`);
        console.log('  如需更新，改 src/lib/agnes.js 的 IMAGE_MODELS / VIDEO_MODELS。');
      }
    } else {
      console.log('网关未返回模型清单，原始响应：');
      console.log(JSON.stringify(raw, null, 2).slice(0, 1000));
    }
    return;
  }

  if (!prompt) {
    console.error('✗ 缺少 prompt');
    usage();
    process.exit(1);
  }

  const initImage = flags.image ? await toDataUri(flags.image) : undefined;

  if (command === 'image') {
    const model = flags.model || DEFAULT_IMAGE_MODEL;
    const spec = IMAGE_MODELS[model];
    if (!spec) throw new Error(`未知生图模型 ${model}，可选：${Object.keys(IMAGE_MODELS).join(' / ')}`);

    console.log(`→ 生图中（${model}）：${prompt}`);
    const { url, b64 } = await client.generateImage({
      prompt,
      model,
      size: flags.size,
      ratio: flags.ratio,
      initImage,
    });

    const filename = `image-${timestamp()}.png`;
    let saved;
    if (url) saved = await saveFromUrl(url, filename);
    else {
      await mkdir(OUTPUT_DIR, { recursive: true });
      saved = path.join(OUTPUT_DIR, filename);
      await writeFile(saved, Buffer.from(b64, 'base64'));
    }
    console.log(`✓ 已保存 ${saved}`);
    if (url) console.log(`  源地址 ${url}`);
    return;
  }

  if (command === 'video') {
    const model = flags.model || DEFAULT_VIDEO_MODEL;
    const spec = VIDEO_MODELS[model];
    if (!spec) throw new Error(`未知视频模型 ${model}，可选：${Object.keys(VIDEO_MODELS).join(' / ')}`);

    const seconds = flags.seconds || VIDEO_SECONDS_DEFAULT;
    console.log(`→ 生视频中（${model}）：${prompt}`);
    console.log(`  ${spec.legacy ? '旧版参数' : `${flags.size || spec.defaultSize} · ${seconds}s · ${flags.ratio || '16:9'}`}`);
    console.log('  异步任务，每 2s 轮询一次');

    const { url, id } = await client.generateVideo({
      prompt,
      model,
      mode: initImage ? 'reference' : 'text',
      seconds,
      size: flags.size,
      aspectRatio: flags.ratio || '16:9',
      images: initImage ? [initImage] : undefined,
      onRetry: ({ attempt, waitMs, reason }) =>
        console.log(`  ⟳ 队列满，第 ${attempt} 次重试，等待 ${Math.round(waitMs / 1000)}s（${reason}）`),
      onProgress: ({ elapsedMs, state }) =>
        console.log(`  … ${Math.round(elapsedMs / 1000)}s 状态=${state}`),
    });

    const saved = await saveFromUrl(url, `video-${timestamp()}.mp4`);
    console.log(`✓ 已保存 ${saved}`);
    console.log(`  videoId=${id}`);
    console.log(`  源地址 ${url}`);
    return;
  }

  console.error(`✗ 未知命令：${command}`);
  usage();
  process.exit(1);
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  if (error.body) console.error(JSON.stringify(error.body, null, 2).slice(0, 1500));
  process.exit(1);
});
