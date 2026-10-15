import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image as ImageIcon, Film, KeyRound, Loader2, Download, AlertCircle, Check } from 'lucide-react';

import {
  createAgnesClient,
  DEFAULT_BASE_URL,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
  IMAGE_MODELS,
  VIDEO_MODELS,
  VIDEO_RATIOS,
  VIDEO_SECONDS_MAX,
  VIDEO_SECONDS_MIN,
  VIDEO_SECONDS_DEFAULT,
} from '../lib/agnes.js';

const KEY_STORAGE = 'agnes_api_key';

/**
 * Key 优先级：localStorage（BYOK，推荐）→ VITE_AGNES_API_KEY（仅本地 dev）。
 * 开发态走 /agnes-api 代理绕开 CORS；生产态直连。
 */
function useAgnesConfig() {
  const [storedKey, setStoredKey] = useState(() => localStorage.getItem(KEY_STORAGE) || '');

  const envKey = import.meta.env.VITE_AGNES_API_KEY || '';
  const apiKey = storedKey || envKey;

  const baseUrl = import.meta.env.DEV
    ? '/agnes-api'
    : import.meta.env.VITE_AGNES_BASE_URL || DEFAULT_BASE_URL;

  const saveKey = useCallback((value) => {
    const trimmed = value.trim();
    if (trimmed) localStorage.setItem(KEY_STORAGE, trimmed);
    else localStorage.removeItem(KEY_STORAGE);
    setStoredKey(trimmed);
  }, []);

  const client = useMemo(
    () => (apiKey ? createAgnesClient({ apiKey, baseUrl }) : null),
    [apiKey, baseUrl],
  );

  return { client, apiKey, storedKey, saveKey, usingEnvKey: !storedKey && !!envKey };
}

function fileToDataUri(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const field = 'w-full mt-1 px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white';
const labelCls = 'text-xs text-slate-500';

function KeyPanel({ storedKey, saveKey, usingEnvKey, client }) {
  const [draft, setDraft] = useState('');
  const [justSaved, setJustSaved] = useState(false);
  const [probe, setProbe] = useState(null);

  const handleSave = () => {
    saveKey(draft);
    setDraft('');
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };

  // 模型清单是最轻的连通性探针：能列出来说明 key 和网络都通。
  const checkModels = async () => {
    setProbe({ busy: true });
    try {
      const { ids } = await client.listModels();
      setProbe({ ok: true, ids });
    } catch (e) {
      setProbe({ ok: false, message: e.message });
    }
  };

  const masked = storedKey ? `${storedKey.slice(0, 6)}••••${storedKey.slice(-4)}` : null;

  return (
    <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 mb-6">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <KeyRound size={16} className="text-slate-400" />
        <h3 className="font-bold text-slate-700">Agnes API Key</h3>
        {masked && (
          <span className="text-[10px] bg-green-100 text-green-600 px-2 py-1 rounded-full">
            已保存 {masked}
          </span>
        )}
        {usingEnvKey && (
          <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-1 rounded-full">
            正在使用 .env 中的 key
          </span>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={masked ? '输入新 key 可覆盖' : 'sk-...'}
          className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={handleSave}
          disabled={!draft.trim()}
          className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-40 hover:bg-slate-900 transition"
        >
          {justSaved ? <Check size={16} /> : '保存'}
        </button>
        {storedKey && (
          <button
            onClick={() => saveKey('')}
            className="px-4 py-2 rounded-lg text-sm border border-slate-200 text-slate-500 hover:bg-slate-50 transition"
          >
            清除
          </button>
        )}
        {client && (
          <button
            onClick={checkModels}
            disabled={probe?.busy}
            className="px-4 py-2 rounded-lg text-sm border border-slate-200 text-slate-600 hover:bg-slate-50 transition disabled:opacity-40"
          >
            {probe?.busy ? '检测中…' : '连通性检测'}
          </button>
        )}
      </div>

      {probe?.ok && (
        <p className="text-xs text-green-600 mt-2 break-words">
          ✓ 可用模型：{probe.ids.join('、') || '(网关未返回清单)'}
        </p>
      )}
      {probe?.ok === false && <p className="text-xs text-red-600 mt-2 break-words">✗ {probe.message}</p>}

      <p className="text-xs text-slate-400 mt-2">
        仅存在本浏览器的 localStorage，不上传、不入库。在{' '}
        <a
          href="https://platform.agnes-ai.com/settings/apiKeys"
          target="_blank"
          rel="noreferrer"
          className="text-blue-600 hover:underline"
        >
          platform.agnes-ai.com
        </a>{' '}
        创建。
      </p>
    </div>
  );
}

function ErrorBox({ error }) {
  if (!error) return null;
  return (
    <div className="flex gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600 mt-3">
      <AlertCircle size={16} className="shrink-0 mt-0.5" />
      <span className="break-words">{error}</span>
    </div>
  );
}

function ResultPane({ kind, src }) {
  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-center min-h-[320px]">
      {src ? (
        <div className="w-full">
          {kind === 'image' ? (
            <img src={src} alt="生成结果" className="w-full rounded-xl" />
          ) : (
            <video src={src} controls className="w-full rounded-xl" />
          )}
          <a
            href={src}
            download={`agnes-${Date.now()}.${kind === 'image' ? 'png' : 'mp4'}`}
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
          >
            <Download size={14} /> 下载
          </a>
        </div>
      ) : (
        <p className="text-slate-300 text-sm">结果将显示在这里</p>
      )}
    </div>
  );
}

function ImageTab({ client }) {
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(DEFAULT_IMAGE_MODEL);
  const spec = IMAGE_MODELS[model];
  const [size, setSize] = useState(spec.defaultSize);
  const [ratio, setRatio] = useState(spec.defaultRatio ?? '1:1');
  const [initImage, setInitImage] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // 换模型时参数形态可能从档位变像素，重置避免传出非法值。
  useEffect(() => {
    setSize(IMAGE_MODELS[model].defaultSize);
    setRatio(IMAGE_MODELS[model].defaultRatio ?? '1:1');
  }, [model]);

  const run = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const { url, b64 } = await client.generateImage({
        prompt, model, size, ratio: spec.ratios ? ratio : undefined, initImage,
      });
      setResult(url || `data:image/png;base64,${b64}`);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="描述你想要的画面…"
          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <label className={`block ${labelCls} mt-3`}>
          模型
          <select value={model} onChange={(e) => setModel(e.target.value)} className={field}>
            {Object.entries(IMAGE_MODELS).map(([id, m]) => (
              <option key={id} value={id}>{id}{m.legacy ? '（旧版）' : ''}</option>
            ))}
          </select>
        </label>
        <p className="text-[11px] text-slate-400 mt-1">{spec.label}</p>

        <div className="grid grid-cols-2 gap-3 mt-3">
          <label className={labelCls}>
            {spec.ratios ? '尺寸档位' : '尺寸'}
            <select value={size} onChange={(e) => setSize(e.target.value)} className={field}>
              {spec.sizes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {spec.ratios && (
            <label className={labelCls}>
              比例
              <select value={ratio} onChange={(e) => setRatio(e.target.value)} className={field}>
                {spec.ratios.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          )}
        </div>

        <label className={`block ${labelCls} mt-3`}>
          参考图（可选，走图生图）
          <input
            type="file"
            accept="image/*"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              setInitImage(file ? await fileToDataUri(file) : null);
            }}
            className="w-full mt-1 text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-slate-100 file:text-slate-600"
          />
        </label>

        <button
          onClick={run}
          disabled={busy || !prompt.trim()}
          className="w-full mt-4 bg-blue-600 text-white py-2.5 rounded-lg font-medium disabled:opacity-40 hover:bg-blue-700 transition flex items-center justify-center gap-2"
        >
          {busy ? <><Loader2 size={16} className="animate-spin" /> 生成中…</> : '生成图片'}
        </button>

        <ErrorBox error={error} />
      </div>

      <ResultPane kind="image" src={result} />
    </div>
  );
}

function VideoTab({ client }) {
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(DEFAULT_VIDEO_MODEL);
  const spec = VIDEO_MODELS[model];
  const [size, setSize] = useState(spec.defaultSize);
  const [seconds, setSeconds] = useState(VIDEO_SECONDS_DEFAULT);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [initImage, setInitImage] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  useEffect(() => setSize(VIDEO_MODELS[model].defaultSize), [model]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true); setError(null); setResult(null);
    setProgress('已提交任务，等待渲染…');

    try {
      const { url } = await client.generateVideo({
        prompt,
        model,
        // 带参考图即走 reference 模式。
        mode: initImage ? 'reference' : 'text',
        seconds,
        size: spec.legacy ? undefined : size,
        aspectRatio,
        images: initImage ? [initImage] : undefined,
        signal: controller.signal,
        onRetry: ({ attempt, waitMs }) =>
          setProgress(`队列已满，第 ${attempt} 次重试（等待 ${Math.round(waitMs / 1000)}s）…`),
        onProgress: ({ elapsedMs, state }) =>
          setProgress(`渲染中 ${Math.round(elapsedMs / 1000)}s · ${state}`),
      });
      setResult(url);
      setProgress(null);
    } catch (e) {
      setError(e.message);
      setProgress(null);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="描述镜头内容、运镜与氛围…"
          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <label className={`block ${labelCls} mt-3`}>
          模型
          <select value={model} onChange={(e) => setModel(e.target.value)} className={field}>
            {Object.entries(VIDEO_MODELS).map(([id, m]) => (
              <option key={id} value={id}>{id}{m.legacy ? '（旧版）' : ''}</option>
            ))}
          </select>
        </label>
        <p className="text-[11px] text-slate-400 mt-1">{spec.label}</p>

        {!spec.legacy && (
          <div className="grid grid-cols-3 gap-3 mt-3">
            <label className={labelCls}>
              清晰度
              <select
                value={size}
                onChange={(e) => setSize(e.target.value)}
                disabled={spec.sizes.length === 1}
                className={`${field} disabled:bg-slate-50 disabled:text-slate-400`}
              >
                {spec.sizes.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className={labelCls}>
              时长 {seconds}s
              <input
                type="range"
                min={VIDEO_SECONDS_MIN}
                max={VIDEO_SECONDS_MAX}
                value={seconds}
                onChange={(e) => setSeconds(e.target.value)}
                className="w-full mt-3 accent-blue-600"
              />
            </label>
            <label className={labelCls}>
              比例
              <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className={field}>
                {VIDEO_RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          </div>
        )}

        <label className={`block ${labelCls} mt-3`}>
          参考图（可选，自动切到 reference 模式）
          <input
            type="file"
            accept="image/*"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              setInitImage(file ? await fileToDataUri(file) : null);
            }}
            className="w-full mt-1 text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-slate-100 file:text-slate-600"
          />
        </label>

        <div className="flex gap-2 mt-4">
          <button
            onClick={run}
            disabled={busy || !prompt.trim()}
            className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg font-medium disabled:opacity-40 hover:bg-blue-700 transition flex items-center justify-center gap-2"
          >
            {busy ? <><Loader2 size={16} className="animate-spin" /> 渲染中…</> : '生成视频'}
          </button>
          {busy && (
            <button
              onClick={() => abortRef.current?.abort()}
              className="px-4 rounded-lg border border-slate-200 text-slate-500 text-sm hover:bg-slate-50 transition"
            >
              取消
            </button>
          )}
        </div>

        {progress && <p className="text-xs text-slate-400 mt-2">{progress}</p>}
        <p className="text-[11px] text-slate-400 mt-2">
          异步任务，每 2s 轮询一次。队列满（503 video_queue_full）会自动退避重试。
        </p>

        <ErrorBox error={error} />
      </div>

      <ResultPane kind="video" src={result} />
    </div>
  );
}

const TABS = [
  { id: 'image', label: '生图', Icon: ImageIcon },
  { id: 'video', label: '生视频', Icon: Film },
];

export default function AgnesStudio() {
  const [tab, setTab] = useState('image');
  const { client, apiKey, storedKey, saveKey, usingEnvKey } = useAgnesConfig();

  return (
    <div>
      <KeyPanel storedKey={storedKey} saveKey={saveKey} usingEnvKey={usingEnvKey} client={client} />

      <div className="flex gap-2 mb-6">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
              tab === id
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white text-slate-500 border border-slate-100 hover:bg-slate-50'
            }`}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      {!apiKey ? (
        <div className="bg-white p-10 rounded-2xl shadow-sm border border-slate-100 text-center text-slate-400 text-sm">
          请先在上方填入 Agnes API Key
        </div>
      ) : tab === 'image' ? (
        <ImageTab client={client} />
      ) : (
        <VideoTab client={client} />
      )}
    </div>
  );
}
