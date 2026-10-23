/**
 * 从 Chrome/Edge 的 netlog 里捞出保利威接口的请求与结果，用来定位播放器初始化卡在哪一步。
 * 用法：node scripts/parse-netlog.mjs tmp/netlog.json
 */
import fs from 'node:fs';

const file = process.argv[2] ?? 'tmp/netlog.json';
const raw = fs.readFileSync(file, 'utf8');
const data = JSON.parse(raw);
const events = data.events ?? [];

const byId = new Map();
for (const e of events) {
  if (e.params?.url && /polyv\.net|polyv\.cn|videocc\.net/.test(e.params.url)) {
    byId.set(e.params.url, { url: e.params.url, netError: e.params.net_error, status: null, type: e.type });
  }
}

// 找 HTTP 响应状态
for (const e of events) {
  const p = e.params ?? {};
  if (e.type === 'HTTP_TRANSACTION_READ_RESPONSE_HEADERS' || e.type === 'URL_REQUEST_REDIRECT_JOB') {
    const url = p.url ?? p.headers?.[0];
    if (typeof url === 'string' && byId.has(url) && Array.isArray(p.headers)) {
      const line = p.headers[0];
      const m = /HTTP\/[\d.]+ (\d{3})/.exec(String(line));
      if (m) byId.get(url).status = Number(m[1]);
    }
  }
}

const rows = [...byId.values()];
const apis = rows.filter((r) => r.url.includes('api.polyv.net'));
console.log(`共 ${rows.length} 个保利威请求，其中 API ${apis.length} 个\n`);
for (const r of apis) {
  const short = r.url.replace('https://api.polyv.net', '').split('?')[0];
  const query = new URL(r.url).searchParams;
  const interesting = ['videoId', 'playbackType', 'vid', 'channelId', 'type']
    .filter((k) => query.has(k))
    .map((k) => `${k}=${query.get(k)}`)
    .join('&');
  console.log(`${String(r.status ?? r.netError ?? '-').padEnd(6)} ${short}  ${interesting}`);
}
