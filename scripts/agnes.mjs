#!/usr/bin/env node
/**
 * Agnes AI 命令行工具 —— 云端会话和本地终端通用。
 *
 *   node scripts/agnes.mjs image "一只在沙滩上散步的猫" --size 1024x768
 *   node scripts/agnes.mjs video "电影感镜头：猫走过沙滩" --size 横屏
 *   node scripts/agnes.mjs video "..." --image ./ref.png      # 图生视频
 *
 * Key 读取顺序：环境变量 AGNES_API_KEY → 项目根目录 .env
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createAgnesClient,
  IMAGE_MODELS,
  VIDEO_SIZES,
  DEFAULT_BASE_URL,
} from '../src/lib/agnes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = path.join(ROOT, 'output');

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch {
    /* Node < 20.12 没有 loadEnvFile，靠环境变量即可 */
  }
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const positional = [];
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) {
      const key = rest[i].slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(rest[i]);
    }
  }
  return { command, prompt: positional.join(' '), flags };
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function saveFromUrl(url, filename) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await mkdir(OUTPUT_DIR, { recursive: true });
  const target = path.join(OUTPUT_DIR, filename);
  await writeFile(target, buffer);
  return target;
}

/** 本地图片 → data URI，用于图生图 / 图生视频。 */
async function toDataUri(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase() || 'png';
  const mime = ext === 'jpg' ? 'jpeg' : ext;
  const buffer = await readFile(filePath);
  return `data:image/${mime};base64,${buffer.toString('base64')}`;
}

function usage() {
  console.log(`
Agnes AI CLI

  node scripts/agnes.mjs image <prompt> [--model <id>] [--size 1024x768] [--image <路径>]
  node scripts/agnes.mjs video <prompt> [--size 横屏|竖屏|方形] [--image <路径>]

可用生图模型：
${IMAGE_MODELS.map((m) => `  ${m.id.padEnd(24)} ${m.label}`).join('\n')}

视频尺寸预设：
${VIDEO_SIZES.map((s) => `  ${s.label}`).join('\n')}

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

  if (!prompt) {
    console.error('✗ 缺少 prompt');
    usage();
    process.exit(1);
  }

  const client = createAgnesClient({
    apiKey,
    baseUrl: process.env.AGNES_BASE_URL || DEFAULT_BASE_URL,
  });

  const initImage = flags.image ? await toDataUri(flags.image) : undefined;

  if (command === 'image') {
    console.log(`→ 生图中：${prompt}`);
    const { url, b64 } = await client.generateImage({
      prompt,
      model: flags.model || IMAGE_MODELS[0].id,
      size: flags.size || '1024x1024',
      initImage,
    });

    const filename = `image-${timestamp()}.png`;
    let saved;
    if (url) {
      saved = await saveFromUrl(url, filename);
    } else {
      await mkdir(OUTPUT_DIR, { recursive: true });
      saved = path.join(OUTPUT_DIR, filename);
      await writeFile(saved, Buffer.from(b64, 'base64'));
    }
    console.log(`✓ 已保存 ${saved}`);
    if (url) console.log(`  源地址 ${url}`);
    return;
  }

  if (command === 'video') {
    const preset =
      VIDEO_SIZES.find((s) => s.label.includes(flags.size ?? '横屏')) ?? VIDEO_SIZES[0];
    console.log(`→ 生视频中：${prompt}`);
    console.log(`  ${preset.label}，异步任务，通常需要数十秒到几分钟`);

    const { url, id } = await client.generateVideo({
      prompt,
      width: preset.width,
      height: preset.height,
      initImage,
      onProgress: ({ elapsedMs, state }) => {
        console.log(`  … ${Math.round(elapsedMs / 1000)}s 状态=${state}`);
      },
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
