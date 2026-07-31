import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image as ImageIcon, Film, KeyRound, Loader2, Download, AlertCircle, Check } from 'lucide-react';

import {
  createAgnesClient,
  DEFAULT_BASE_URL,
  IMAGE_MODELS,
  IMAGE_SIZES,
  VIDEO_SIZES,
} from '../lib/agnes.js';

const KEY_STORAGE = 'agnes_api_key';

/**
 * Key 优先级：localStorage（BYOK，推荐）→ VITE_AGNES_API_KEY（仅本地 dev）。
 * 开发态走 /agnes-api 代理绕开 CORS；生产态直连。
 */
function useAgnesConfig() {
  const [storedKey, setStoredKey] = useState(
    () => localStorage.getItem(KEY_STORAGE) || '',
  );

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

function KeyPanel({ storedKey, saveKey, usingEnvKey }) {
  const [draft, setDraft] = useState('');
  const [justSaved, setJustSaved] = useState(false);

  const handleSave = () => {
    saveKey(draft);
    setDraft('');
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };

  const masked = storedKey ? `${storedKey.slice(0, 6)}••••${storedKey.slice(-4)}` : null;

  return (
    <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 mb-6">
      <div className="flex items-center gap-2 mb-3">
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
      </div>

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

function ImageTab({ client }) {
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(IMAGE_MODELS[0].id);
  const [size, setSize] = useState(IMAGE_SIZES[0]);
  const [initImage, setInitImage] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const { url, b64 } = await client.generateImage({ prompt, model, size, initImage });
      setResult(url || `data:image/png;base64,${b64}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
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

        <div className="grid grid-cols-2 gap-3 mt-3">
          <label className="text-xs text-slate-500">
            模型
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white"
            >
              {IMAGE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.id}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-500">
            尺寸
            <select
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white"
            >
              {IMAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>

        <p className="text-[11px] text-slate-400 mt-2">
          {IMAGE_MODELS.find((m) => m.id === model)?.label}
        </p>

        <label className="block text-xs text-slate-500 mt-3">
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

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-center min-h-[320px]">
        {result ? (
          <div className="w-full">
            <img src={result} alt="生成结果" className="w-full rounded-xl" />
            <a
              href={result}
              download={`agnes-${Date.now()}.png`}
              className="mt-3 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
            >
              <Download size={14} /> 下载
            </a>
          </div>
        ) : (
          <p className="text-slate-300 text-sm">结果将显示在这里</p>
        )}
      </div>
    </div>
  );
}

function VideoTab({ client }) {
  const [prompt, setPrompt] = useState('');
  const [presetLabel, setPresetLabel] = useState(VIDEO_SIZES[0].label);
  const [initImage, setInitImage] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async () => {
    const preset = VIDEO_SIZES.find((s) => s.label === presetLabel);
    const controller = new AbortController();
    abortRef.current = controller;

    setBusy(true);
    setError(null);
    setResult(null);
    setProgress('已提交任务，等待渲染…');

    try {
      const { url } = await client.generateVideo({
        prompt,
        width: preset.width,
        height: preset.height,
        initImage,
        signal: controller.signal,
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

        <label className="block text-xs text-slate-500 mt-3">
          画幅
          <select
            value={presetLabel}
            onChange={(e) => setPresetLabel(e.target.value)}
            className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white"
          >
            {VIDEO_SIZES.map((s) => <option key={s.label} value={s.label}>{s.label}</option>)}
          </select>
        </label>

        <label className="block text-xs text-slate-500 mt-3">
          首帧图（可选，走图生视频）
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
          异步任务，轮询间隔 12s（视频限速 5 RPM）。每日配额 500 秒。
        </p>

        <ErrorBox error={error} />
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-center min-h-[320px]">
        {result ? (
          <div className="w-full">
            <video src={result} controls className="w-full rounded-xl" />
            <a
              href={result}
              download={`agnes-${Date.now()}.mp4`}
              className="mt-3 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
            >
              <Download size={14} /> 下载
            </a>
          </div>
        ) : (
          <p className="text-slate-300 text-sm">结果将显示在这里</p>
        )}
      </div>
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
      <KeyPanel storedKey={storedKey} saveKey={saveKey} usingEnvKey={usingEnvKey} />

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
