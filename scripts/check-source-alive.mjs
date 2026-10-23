/**
 * 验证：录制文件的 mp4 直链是否还能播（403 是「链接过期」还是「文件已删」）
 * 做法：现场重新调一次 record-file/list 拿新 auth_key，再 HEAD/range 测试。
 * 用法：node scripts/check-source-alive.mjs  → tmp/source-alive.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'tmp', 'source-alive.md');
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const APP_ID = 'REDACTED-APPID';
const APP_SECRET = 'REDACTED-ROTATE-THIS-SECRET';
const CHANNEL = '4711207';

const sign = (params) =>
  createHash('md5')
    .update(
      APP_SECRET +
        Object.keys(params).filter((k) => params[k] !== '').sort().map((k) => `${k}${params[k]}`).join('') +
        APP_SECRET,
      'utf8',
    )
    .digest('hex')
    .toUpperCase();

async function api(urlPath, business = {}) {
  const params = { ...business, appId: APP_ID, timestamp: String(Date.now()) };
  params.sign = sign(params);
  const url = new URL('https://api.polyv.net' + urlPath);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  return r.json();
}

async function probe(url) {
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-1023', 'User-Agent': 'Mozilla/5.0' } });
    return `${r.status}${r.headers.get('content-length') ? ' len=' + r.headers.get('content-length') : ''}`;
  } catch (e) {
    return 'ERR ' + e.message;
  }
}

let md = '# 片源存活检测（现场重新签名）\n\n';
const res = await api('/live/v4/channel/record-file/list', { channelId: CHANNEL, pageNumber: 1, pageSize: 100 });
md += `接口 code=${res.code} message=${res.message ?? ''} 条数=${res.data?.contents?.length ?? 0}\n\n`;
md += '| channelSessionId | 时长 | 旧链接(缓存) | 新链接(现场) | daysLeft |\n|---|---|---|---|---|\n';

const cached = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'raw', 'record-file-list.json'), 'utf8'));
const oldList = Array.isArray(cached) ? cached : cached.contents;
const fresh = res.data?.contents ?? [];

for (const f of fresh) {
  const old = oldList.find((x) => x.fileId === f.fileId);
  const oldProbe = old?.mp4 ? await probe(old.mp4) : 'n/a';
  const newProbe = f.mp4 ? await probe(f.mp4) : '无 mp4';
  md += `| ${f.channelSessionId} | ${f.duration}s | ${oldProbe} | ${newProbe} | ${f.daysLeft} |\n`;
  md += `| | | \`${(old?.mp4 ?? '').slice(0, 60)}…\` | \`${(f.mp4 ?? '').slice(0, 60)}…\` | |\n`;
}

fs.writeFileSync(OUT, md, 'utf8');
console.log(md);
