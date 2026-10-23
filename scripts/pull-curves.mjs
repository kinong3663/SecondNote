/**
 * 拉取所有场次日期的分钟级曲线（concurrence 必须单日查）
 * 输出：public/data/raw/curve-<day>.json  { day, base, series:[{t(分钟), viewers}] }
 *
 * 用法：node scripts/pull-curves.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const APP_ID = process.env.POLYV_APP_ID || 'REDACTED-APPID';
const SECRET = process.env.POLYV_APP_SECRET || 'REDACTED-ROTATE-THIS-SECRET';
const CHANNEL = process.env.POLYV_CHANNEL_ID || '4711207';
const RAW = path.join(process.cwd(), 'public', 'data', 'raw');

const md5sign = (p) => crypto.createHash('md5')
  .update(SECRET + Object.keys(p).filter((k) => p[k] !== '' && p[k] != null).sort().map((k) => k + p[k]).join('') + SECRET, 'utf8')
  .digest('hex').toUpperCase();

async function live(pathname, business) {
  const p = { ...business, appId: APP_ID, timestamp: Date.now() };
  p.sign = md5sign(p);
  const r = await fetch(`https://api.polyv.net${pathname}?${new URLSearchParams(p)}`);
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { code: -1, message: text.slice(0, 120) }; }
}

// 从契约里取所有场次日期
const sessionsFile = path.join(process.cwd(), 'public', 'data', 'contract', 'sessions.json');
const sessions = JSON.parse(fs.readFileSync(sessionsFile, 'utf8')).sessions;
const days = [...new Set(sessions.map((s) => s.day))].filter((d) => !d.startsWith('2026-10-23')).sort();

console.log(`场次涉及 ${days.length} 个日期：${days.join(', ')}\n`);

let ok = 0;
for (const day of days) {
  const j = await live('/live/v3/channel/statistics/concurrence', { channelId: CHANNEL, startDate: day, endDate: day });
  const rows = (j.data ?? []).slice().sort((a, b) => a.minute.localeCompare(b.minute));
  if (!rows.length) {
    console.log(`  ${day}  0 行（无并发数据）`);
    continue;
  }
  // 起点 = 当天最早的分钟
  const base = rows[0].minute;
  const [bh, bm] = base.split(':').map(Number);
  const series = rows.map((r) => {
    const [h, m] = r.minute.split(':').map(Number);
    return { t: (h * 60 + m) - (bh * 60 + bm), viewers: Number(r.viewers) };
  }).filter((p) => p.t >= 0);
  const peak = Math.max(...series.map((p) => p.viewers));
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(path.join(RAW, `curve-${day}.json`), JSON.stringify({ day, base, series }, null, 1), 'utf8');
  console.log(`  ${day}  ${String(rows.length).padStart(4)} 行 · 起点 ${base} · 峰值 ${String(peak).padStart(3)} 人`);
  ok++;
}
console.log(`\n✅ ${ok} 天的曲线已落盘 → public/data/raw/curve-<day>.json`);
