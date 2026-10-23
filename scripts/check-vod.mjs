/**
 * 点播（vod）播放问题诊断：
 *   1. 频道播放配置 /live/v4/channel/playback/list —— origin 与 videoList 的原始字段
 *   2. 回放列表 /live/v3/user/playback/list?listType=vod 与 playback —— 到底哪些是点播
 *   3. 逐个 vid 试 VOD 侧接口，看这些 vid 在点播库里是否存在
 * 用法：node scripts/check-vod.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'tmp', 'vod-report.md');
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const APP_ID = 'REDACTED-APPID';
const APP_SECRET = 'REDACTED-ROTATE-THIS-SECRET';
const VOD_USERID = 'bfcb278e7a';
const VOD_SECRET = 'REDACTED-ROTATE-THIS-VOD-KEY';
const CHANNEL = '4711207';

const liveSign = (p) =>
  createHash('md5')
    .update(
      APP_SECRET +
        Object.keys(p).filter((k) => p[k] !== '').sort().map((k) => `${k}${p[k]}`).join('') +
        APP_SECRET,
      'utf8',
    )
    .digest('hex')
    .toUpperCase();

async function liveApi(urlPath, business = {}) {
  const params = { ...business, appId: APP_ID, timestamp: String(Date.now()) };
  params.sign = liveSign(params);
  const url = new URL('https://api.polyv.net' + urlPath);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  return r.json();
}

const vodSign = (p) =>
  createHash('sha1')
    .update(
      Object.keys(p).filter((k) => p[k] !== '').sort().map((k) => `${k}=${p[k]}`).join('&') +
        '&' + VOD_SECRET,
      'utf8',
    )
    .digest('hex')
    .toUpperCase();

async function vodApi(urlPath, business = {}) {
  const params = { ...business, userid: VOD_USERID, ptime: String(Date.now()) };
  params.sign = vodSign(params);
  const url = new URL('https://api.polyv.net' + urlPath);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return { http: r.status, raw: text.slice(0, 200) };
  }
}

let md = '# 点播播放问题诊断\n\n';

// 1. 频道播放配置
const cfg = await liveApi('/live/v4/channel/playback/list', { channelIds: CHANNEL });
const entry = (cfg.data ?? []).find((x) => String(x.channelId) === CHANNEL) ?? cfg.data?.[0];
md += '## 1. 频道播放配置 `/live/v4/channel/playback/list`\n\n';
md += `code=${cfg.code} · channelId=${entry?.channelId} · **origin=${entry?.origin}** · videoList=${entry?.videoList?.length ?? 0}\n\n`;
if (entry?.videoList?.length) {
  md += '```json\n' + JSON.stringify(entry.videoList.slice(0, 2), null, 1) + '\n```\n\n';
}

// 2. 两种 listType 的列表
for (const listType of ['playback', 'vod']) {
  const res = await liveApi('/live/v3/user/playback/list', {
    channelId: CHANNEL,
    page: 1,
    pageSize: 100,
    listType,
    order: 'timeDesc',
  });
  const list = res.data?.contents ?? [];
  md += `## 2. \`/live/v3/user/playback/list?listType=${listType}\` → ${list.length} 条\n\n`;
  for (const v of list) {
    md += `- vid=${v.videoId} origin=${v.origin ?? '-'} title=${String(v.name ?? v.title ?? '').slice(0, 24)} dur=${v.duration}\n`;
  }
  md += '\n';
}

// 3. 逐个 vid 在 VOD 库里的存在性
const vids = (entry?.videoList ?? []).map((v) => String(v.videoId ?? '')).filter(Boolean);
md += '## 3. 这些 vid 在点播库里存在吗（VOD v2 `/v2/videos/{vid}`）\n\n';
md += '| vid | HTTP/code | 结果 |\n|---|---|---|\n';
for (const vid of vids.slice(0, 6)) {
  const res = await vodApi(`/v2/videos/${vid}`);
  const code = res.code ?? res.http ?? '?';
  const msg = String(res.message ?? res.status ?? res.error ?? '').slice(0, 40);
  md += `| ${vid} | ${code} | ${msg} |\n`;
}
md += '\n';

// 4. 点播字幕能力：某个 vid 的 srt 列表
md += '## 4. 点播字幕接口 `GET /v2/videos/{vid}/srt/list`\n\n';
for (const vid of vids.slice(0, 2)) {
  const res = await vodApi(`/v2/videos/${vid}/srt/list`);
  md += `- ${vid}: code=${res.code ?? res.http} ${String(res.message ?? '').slice(0, 60)} ${JSON.stringify(res.data ?? '').slice(0, 120)}\n`;
}
md += '\n';

fs.writeFileSync(OUT, md, 'utf8');
console.log(md);
