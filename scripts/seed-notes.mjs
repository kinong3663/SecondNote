/**
 * 给「当前默认视频」灌一批样例秒记卡（覆盖 5 种类型），用来看教师端的热力图效果。
 * 卡片走真实接口 POST /api/notes，和观众点出来的一模一样。
 *
 * 用法：
 *   node scripts/seed-notes.mjs          灌 8 张
 *   node scripts/seed-notes.mjs --clear  清空
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://127.0.0.1:8787';
const CHANNEL = process.env.CHANNEL || '4711207';
const NOTES_DIR = path.join(process.cwd(), '秒记卡', 'work', 'notes', CHANNEL);

const clear = process.argv.includes('--clear');

const bundle = await (await fetch(`${BASE}/api/channel/${CHANNEL}`)).json();
const videoKey = bundle?.channel?.videoKey;
const duration = Number(bundle?.channel?.duration || 0);
if (!videoKey || !duration) {
  console.error('拿不到当前视频，确认服务端在跑：npm start');
  process.exit(1);
}

const file = path.join(NOTES_DIR, `${videoKey.replace(/[^a-zA-Z0-9_-]/g, '_')}.jsonl`);

if (clear) {
  if (fs.existsSync(file)) fs.unlinkSync(file);
  console.log(`已清空 ${path.basename(file)}`);
  process.exit(0);
}

const TYPE_CYCLE = ['question', 'key', 'step', 'question', 'key', 'fix', 'step', 'case'];
const SUMMARY = [
  '这里的参数怎么定',
  '这个交付标准要记住',
  '先点这个再点那个',
  '为什么这里要放大',
  '开场就说了这节课要做什么',
  '这句好像讲反了',
  '导出设置记一下',
  '这个案例可以抄',
];
const SUBTITLE = [
  '这个参数我们是根据',
  '需要交给老师的是要交付给企业的',
  '第一步我们先打开',
  '我们可以看到它的边缘',
  '有声音吗',
  '其实是反过来的',
  '导出的时候选这个',
  '比如说像我们之前做的那个',
];

const count = TYPE_CYCLE.length;
for (let i = 0; i < count; i += 1) {
  const body = {
    id: `seed-${Date.now()}-${i}`,
    channelId: CHANNEL,
    videoKey,
    type: TYPE_CYCLE[i],
    // 均匀铺在整条视频上，并错开 37 秒，避免全部落在同一格
    time: Math.round(((i + 0.5) / count) * duration) + i * 37,
    duration,
    subtitle: SUBTITLE[i],
    summary: SUMMARY[i],
    visitorId: `seed-v${(i % 3) + 1}`,
    createdAt: new Date().toISOString(),
  };
  const response = await fetch(`${BASE}/api/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) console.error('写入失败', i, await response.text());
}

console.log(`已灌 ${count} 张到 ${videoKey}（时长 ${Math.round(duration / 60)} 分钟）`);
console.log('教师端：' + `${BASE}/teacher`);
