/**
 * 目标点播视频诊断：
 *   1. 点播字幕列表（正确路径 /v2/video/{userid}/srt/list）
 *   2. 该 vid 在频道观看页里能否被解析到（watch-api channel/detail 的 playback 字段）
 * 用法：node scripts/check-vod-srt.mjs
 */
import { createHash } from 'node:crypto';

const USERID = process.env.POLYV_VOD_USERID;
const SECRET = process.env.POLYV_VOD_SECRETKEY;
const VID = process.env.POLYV_DEMO_VIDEO_ID || 'bfcb278e7a88e2d51e23ba453596ddf2_b';
const CHANNEL = process.env.POLYV_DEMO_CHANNEL_ID || '4711207';

if (!USERID || !SECRET) {
  console.error('缺少点播凭证：先设置 POLYV_VOD_USERID / POLYV_VOD_SECRETKEY');
  process.exit(1);
}

const sign = (params) =>
  createHash('sha1')
    .update(
      Object.keys(params).filter((k) => params[k] !== '').sort().map((k) => `${k}=${params[k]}`).join('&') +
        '&' + SECRET,
      'utf8',
    )
    .digest('hex')
    .toUpperCase();

async function vod(path, business) {
  const params = { ...business, ptime: String(Date.now()) };
  params.sign = sign(params);
  const url = new URL('https://api.polyv.net' + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url);
  return { status: r.status, body: await r.text() };
}

const srt = await vod(`/v2/video/${USERID}/srt/list`, { vid: VID });
console.log('=== 点播字幕列表 ===');
console.log(srt.status, srt.body.slice(0, 900));

const detail = await fetch(
  `https://watch-api.polyv.cn/v3/common/channel/detail?channelId=${CHANNEL}&vid=${VID}&playbackType=vod&clientVersion=2.20.0`,
  { headers: { Referer: 'http://127.0.0.1:8787/', 'User-Agent': 'Mozilla/5.0' } },
);
const dj = await detail.json();
console.log('\n=== 观看页能否解析这条点播 ===');
console.log('code=', dj.code, 'status=', dj.status);
const d = dj.data ?? {};
console.log('playback=', JSON.stringify(d.playback ?? null).slice(0, 500));
console.log('liveStatus=', JSON.stringify(d.liveStatus ?? null));
console.log('authSettings=', JSON.stringify(d.authSetting?.authSettings?.map((a) => ({ authType: a.authType, enabled: a.enabled })) ?? null));
