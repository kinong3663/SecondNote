/**
 * 平台字幕与官方 AI 大纲
 *
 * 字幕：录制文件的 subtitleList[0].srtUrl（保利威 AI 智能字幕，status=finish 才有）
 * 大纲：录制文件的 outline.outlineUrl（另一份 JSON，章节还带 startIndex/endIndex）
 *
 * 时间轴说明：SRT 的时间是相对**本条视频**的，观众端拿 player.currentTime 直接比，
 * 不做任何偏移校正（早前做「直播场次对齐」时用的 +2s 是另一回事，别混进来）。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const cacheDir = path.join(projectRoot, 'work', 'subtitles');

const memory = new Map();

export function parseSrt(text) {
  const cues = [];
  const blocks = String(text)
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/);
  const re = /^((?:\d{1,}:)?\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*((?:\d{1,}:)?\d{2}:\d{2}[,.]\d{1,3})/;
  const toSec = (t) => {
    const m = t.match(/^(?:(\d{1,}):)?(\d{2}):(\d{2})[,.](\d{1,3})$/);
    if (!m) return null;
    return (
      Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000
    );
  };
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    const index = lines.findIndex((line) => re.test(line.trim()));
    if (index < 0) continue;
    const match = lines[index].trim().match(re);
    const start = toSec(match[1]);
    const end = toSec(match[2]);
    const body = lines
      .slice(index + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (start != null && end != null && body) cues.push({ start, end, text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

export function parseHms(value) {
  const m = String(value ?? '').match(/^(?:(\d{1,}):)?(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
}

function cacheFile(kind, key) {
  const safe = String(key).replace(/[^a-zA-Z0-9_-]/g, '_').slice(-80);
  return path.join(cacheDir, `${kind}-${safe}.json`);
}

async function cachedFetch(kind, key, url, transform) {
  if (memory.has(url)) return memory.get(url);
  try {
    const raw = await readFile(cacheFile(kind, key), 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.items)) {
      memory.set(url, parsed.items);
      return parsed.items;
    }
  } catch {
    /* 没缓存就走网络 */
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`拉取${kind}失败 HTTP ${response.status}`);
  const items = transform(await response.text());
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cacheFile(kind, key), JSON.stringify({ url, createdAt: new Date().toISOString(), items }), 'utf8');
  memory.set(url, items);
  return items;
}

/** 平台 SRT → cues[]（观众端 findNearbyCue 直接吃） */
export async function fetchSubtitleCues(srtUrl, key) {
  return cachedFetch('srt', key, srtUrl, (text) => parseSrt(text));
}

/* ---------------- 点播（VOD）字幕 ---------------- */

/** 点播签名：参数按名字典序 key=value 用 & 拼接，末尾直接接 secretkey，SHA1 大写 */
function vodSign(params, secretkey) {
  const raw = Object.keys(params)
    .filter((key) => params[key] !== '' && params[key] != null)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return createHash('sha1').update(`${raw}${secretkey}`, 'utf8').digest('hex').toUpperCase();
}

/**
 * 查点播字幕列表 → 取第一条 SRT 并解析成 cues
 * 文档：GET /v2/video/{userid}/srt/list   （注意是 video 单数 + userid 在路径上）
 */
export async function fetchVodSubtitleCues(vid, userid, secretkey) {
  if (!userid || !secretkey) throw new Error('未配置点播 userid / secretkey');
  const params = { userid, ptime: String(Date.now()), vid };
  const sign = vodSign(params, secretkey);
  const url = new URL(`https://api.polyv.net/v2/video/${userid}/srt/list`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set('sign', sign);

  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const data = await response.json().catch(() => null);
  if (!data || data.code !== 200) {
    throw new Error(`点播字幕列表失败：${data?.message ?? response.status}`);
  }
  const srt = (data.data?.srts ?? [])[0];
  if (!srt?.url) return { cues: [], srtUrl: '', name: '' };
  const cues = await fetchSubtitleCues(srt.url, `vod-${vid}`);
  return { cues, srtUrl: srt.url, name: String(srt.name ?? '') };
}

/**
 * 官方 AI 大纲 → 章节（只保留时间，业务侧不需要正文）
 * 注意：大纲可能是嵌套的（父章包住子章），去重与"取最深章节"交给聚合侧处理。
 */
export async function fetchOutlineChapters(outlineUrl, key) {
  return cachedFetch('outline', key, outlineUrl, (text) => {
    const data = JSON.parse(text);
    // outlineUrl 指向的是「原始大纲文件」，顶层直接是 outlineContent；
    // 而 get-by-fileId 接口返回的是 {status, outline:{outlineContent}} 包一层 —— 两种都吃。
    const list = data?.outline?.outlineContent ?? data?.outlineContent ?? [];
    return list
      .map((item) => {
        const start = parseHms(item.startTime);
        const end = parseHms(item.endTime);
        return {
          title: String(item.title ?? '').trim(),
          start,
          end,
          startIndex: Number(item.startIndex ?? 0),
          endIndex: Number(item.endIndex ?? 0),
          summary: Array.isArray(item.summary) ? item.summary : [],
          keyword: Array.isArray(item.keyword) ? item.keyword : [],
        };
      })
      .filter((item) => item.title && item.start != null && item.end != null && item.end > item.start);
  });
}
