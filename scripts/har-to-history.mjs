/**
 * ReLive · 从浏览器 HAR 还原三线数据（不用 appId / appSecret，走观众侧）
 *
 * 怎么拿到 HAR：
 *   1. Chrome/Edge 打开 https://live.polyv.cn/watch/4711207 ，切到回放那场，播完（弹幕会跟着刷）
 *   2. F12 → Network → 勾选 Preserve log → 刷新页面并播放
 *   3. 右键请求列表 → Save all as HAR with content → 存成 public/data/session.har
 *
 * 用法：
 *   node scripts/har-to-history.mjs --inspect          # 只看 HAR 里有什么，不改数据
 *   node scripts/har-to-history.mjs                    # 提取并生成 public/data/history.json
 *   node scripts/har-to-history.mjs --file xxx.har --bucket 5
 */
import fs from 'node:fs';
import path from 'node:path';

const DATA = path.join(process.cwd(), 'public', 'data');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const INSPECT = argv.includes('--inspect');
const FILE = arg('file', 'session.har');
const BUCKET = Number(arg('bucket', 5));

const harPath = path.isAbsolute(FILE) ? FILE : path.join(DATA, FILE);
if (!fs.existsSync(harPath)) {
  console.error(`找不到 HAR：${harPath}`);
  console.error('先在浏览器里导出 HAR（见文件头注释），再跑这个脚本。');
  process.exit(2);
}

const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
const entries = har?.log?.entries ?? [];
console.log(`HAR 里共 ${entries.length} 条请求 · 文件 ${path.basename(harPath)}`);

/** 递归找出所有「对象数组」，用于兜底识别数据形状 */
function findObjectArrays(node, out = [], depth = 0) {
  if (depth > 6 || node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    if (node.length >= 3 && node.every((x) => x && typeof x === 'object' && !Array.isArray(x))) out.push(node);
    for (const v of node) findObjectArrays(v, out, depth + 1);
  } else {
    for (const v of Object.values(node)) findObjectArrays(v, out, depth + 1);
  }
  return out;
}

function parseBody(entry) {
  const text = entry?.response?.content?.text;
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

const TIME_KEYS = ['time', 'timestamp', 'ts', 'createTime', 'msgTime', 'startTime', 't', 'second'];
const VALUE_KEYS = ['count', 'online', 'onlineNum', 'num', 'viewerCount', 'value', 'total'];

/** 猜一个数组是不是时间序列：有可识别的时间字段 + 数值字段 */
function guessSeries(arr) {
  const sample = arr.slice(0, 5);
  const timeKey = TIME_KEYS.find((k) => sample.every((o) => typeof o[k] === 'number' || /^\d+$/.test(o[k] ?? '')));
  const valueKey = VALUE_KEYS.find((k) => sample.every((o) => typeof o[k] === 'number' || /^\d+$/.test(o[k] ?? '')));
  if (!timeKey || !valueKey) return null;
  const norm = arr.map((o) => ({ t: Number(o[timeKey]), v: Number(o[valueKey]) })).filter((x) => Number.isFinite(x.t) && Number.isFinite(x.v));
  return norm.length >= 3 ? { timeKey, valueKey, points: norm } : null;
}

/** 猜一个数组是不是事件列表（弹幕）：只有时间字段，没有数值字段 */
function guessEvents(arr) {
  const sample = arr.slice(0, 5);
  const timeKey = TIME_KEYS.find((k) => sample.every((o) => typeof o[k] === 'number' || /^\d+$/.test(String(o[k] ?? ''))));
  if (!timeKey) return null;
  const hasValue = VALUE_KEYS.some((k) => sample.every((o) => typeof o[k] === 'number'));
  if (hasValue) return null;
  const times = arr.map((o) => Number(o[timeKey])).filter(Number.isFinite);
  return times.length >= 3 ? { timeKey, times } : null;
}

const interesting = /chat|message|danmu|concurrency|viewdata|online|subtitle|srt|outline|viewer/i;
const matched = entries.filter((e) => interesting.test(e.request?.url ?? ''));

console.log(`\n=== 感兴趣 / 可能需要解析的请求（${matched.length} 条） ===`);
for (const e of matched.slice(0, 40)) {
  const url = e.request.url.replace(/^https?:\/\//, '');
  const status = e.response?.status;
  const size = e.response?.content?.size ?? 0;
  const body = parseBody(e);
  const arrays = body ? findObjectArrays(body) : [];
  const guess = arrays.map(guessSeries).find(Boolean);
  const events = arrays.map(guessEvents).find(Boolean);
  console.log(
    `  ${String(status).padEnd(4)} ${String(size).padStart(7)}B  ${url.slice(0, 110)}` +
      (guess ? `  → 疑似序列 [${guess.timeKey}/${guess.valueKey}] × ${guess.points.length}` : '') +
      (events ? `  → 疑似事件 [${events.timeKey}] × ${events.times.length}` : ''),
  );
}

if (INSPECT) {
  console.log('\n--inspect 模式：只列清单，不生成文件。');
  process.exit(0);
}

/** 提取：优先并发曲线，其次聊天记录 */
let onlinePoints = null;
let chatPoints = null;
let subtitleText = null;

for (const e of matched) {
  const url = e.request.url;
  const body = parseBody(e);
  if (!body) {
    // 可能是纯文本（SRT）
    const text = e.response?.content?.text ?? '';
    if (/WEBVTT|-->/.test(text) && !subtitleText) subtitleText = text;
    continue;
  }
  const arrays = findObjectArrays(body);
  for (const arr of arrays) {
    // 弹幕：事件列表（每条一个时间戳）
    if (/chat|message|danmu/i.test(url) && !chatPoints) {
      const ev = guessEvents(arr);
      if (ev) { chatPoints = ev.times.map((t) => ({ t, v: 1 })); continue; }
    }
    // 在线人数：时间序列
    const g = guessSeries(arr);
    if (!g) continue;
    if (/concurrency|online|viewdata/i.test(url) && !onlinePoints) onlinePoints = g.points;
    if (/chat|message|danmu/i.test(url) && !chatPoints) chatPoints = g.points;
  }
}

if (!onlinePoints && !chatPoints) {
  console.warn('\n⚠️ 没识别出序列数据。把上面清单里"看起来像在线人数/弹幕"的那几条 URL 发我，我加上字段映射。');
  process.exit(1);
}

/** 统一到「相对秒」：选定最早时间点作为 0 */
const allT = [...(onlinePoints ?? []), ...(chatPoints ?? [])].map((p) => p.t);
const baseMs = Math.min(...allT);
const toSec = (t) => (t > 1e12 ? (t - baseMs) / 1000 : t > 1e9 ? t - baseMs / 1000 : t);

const buckets = new Map();
const bucketOf = (sec) => Math.floor(sec / BUCKET) * BUCKET;

for (const p of onlinePoints ?? []) {
  const sec = toSec(p.t);
  const b = bucketOf(sec);
  if (!buckets.has(b)) buckets.set(b, { t: b, online: 0, chat: 0, sentiment: 0 });
  buckets.get(b).online = Math.round(p.v);
}
for (const p of chatPoints ?? []) {
  const sec = toSec(p.t);
  const b = bucketOf(sec);
  if (!buckets.has(b)) buckets.set(b, { t: b, online: 0, chat: 0, sentiment: 0 });
  buckets.get(b).chat += 1;
}

const series = [...buckets.values()].sort((a, b) => a.t - b.t);
// 在线人数缺失的桶用前值填充
let last = series.find((s) => s.online > 0)?.online ?? 0;
for (const s of series) { if (!s.online) s.online = last; else last = s.online; }

const durationSec = series.at(-1)?.t ?? 0;
const history = {
  meta: {
    channelId: '4711207',
    title: `回放 4711207（HAR 还原）`,
    date: new Date().toISOString().slice(0, 10),
    durationSec,
    bucketSec: BUCKET,
    source: 'har',
    generatedAt: new Date().toISOString(),
    hasSubtitle: Boolean(subtitleText),
  },
  segments: [], // 等字幕解析后再填；没有字幕就用台本切段
  series,
};

fs.writeFileSync(path.join(DATA, 'history.json'), JSON.stringify(history, null, 2), 'utf8');
console.log(`\n✅ public/data/history.json  ${series.length} 个采样点 / ${durationSec}s，来源 HAR`);
console.log(`   在线人数 ${series[0].online} → ${series.at(-1).online}`);
console.log(`   弹幕总条数 ${(chatPoints ?? []).length}`);
if (subtitleText) {
  const srtPath = path.join(DATA, 'subtitle.srt');
  fs.writeFileSync(srtPath, subtitleText, 'utf8');
  console.log(`✅ public/data/subtitle.srt  ${subtitleText.split('\n').length} 行（可直接喂给 AI 总结模块的 parseAISubtitleContent）`);
}
