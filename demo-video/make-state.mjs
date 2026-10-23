/**
 * 从服务端的真实秒记里，重建学生端的 localStorage，做成 Playwright 的 storageState。
 * 用途：单独补录某一段时，学生端侧栏还是原来那三张卡（不用重新点一遍、也不会给教师端多加卡片）。
 *
 * 用法：node make-state.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)); // demo-video/
const REPO = path.resolve(HERE, '..'); // 仓库根
const CHANNEL = process.env.DEMO_CHANNEL_ID || '4711207';
const VIDEO_KEY = process.env.DEMO_VIDEO_KEY || 'vod:bfcb278e7a88e2d51e23ba453596ddf2_b';
const JSONL = path.join(
  REPO,
  '秒记卡',
  'work',
  'notes',
  CHANNEL,
  `${VIDEO_KEY.replace(/[^a-zA-Z0-9_-]/g, '_')}.jsonl`,
);

const cards = fs
  .readFileSync(JSONL, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter((c) => c.visitorId && !c.visitorId.startsWith('seed-'));

// 录屏时点的那三张：32'29" / 59'13" / 133'50"
const WANTED = [
  [1948, 1952],
  [3552, 3557],
  [8027, 8032],
];
const picked = WANTED.map(([a, b]) => cards.find((c) => c.time >= a && c.time <= b)).filter(Boolean);
if (picked.length !== 3) {
  console.error('没凑齐三张卡，实际:', picked.length, cards.map((c) => c.time));
  process.exit(1);
}

const notes = picked.map((c) => ({
  id: c.id,
  channelId: CHANNEL,
  videoId: c.videoKey,
  time: c.time,
  duration: c.duration,
  subtitle: c.subtitle,
  summary: c.summary,
  type: c.type,
  visitorId: c.visitorId,
  createdAt: c.createdAt,
}));

const visitorId = notes[0].visitorId;
const notesValue = JSON.stringify(notes);
const storage = [
  { name: `second-note:${CHANNEL}:${VIDEO_KEY}`, value: notesValue },
  { name: `second-note:${CHANNEL}:${VIDEO_KEY.replace(/^vod:/, '')}`, value: notesValue },
  { name: 'second-note:visitor-id', value: visitorId },
];

const state = {
  cookies: [],
  origins: [
    { origin: process.env.DEMO_BASE || 'http://127.0.0.1:8787', localStorage: storage },
  ],
};
const target = path.join(HERE, 'raw', 'segments', 'storage-state.json');
fs.writeFileSync(target, JSON.stringify(state), 'utf8');
console.log('写入', target);
for (const n of notes) console.log(`  ${n.time}s ${n.type} ${n.summary}`);
