/**
 * 端到端验证：观众卡片上报 → 教师端聚合
 * 用法：node scripts/verify-live.mjs [--keep]
 *   --keep  保留写入的测试卡片（默认会清空，让演示从 0 开始）
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://127.0.0.1:8787';
const CHANNEL = '4711207';
const VIDEO_KEY = 'record:74f7a46b633d1c96b9081ea60d122272';
const NOTES_FILE = path.join(
  process.cwd(),
  '秒记卡',
  'work',
  'notes',
  CHANNEL,
  `${VIDEO_KEY.replace(/[^a-zA-Z0-9_-]/g, '_')}.jsonl`,
);

const keep = process.argv.includes('--keep');

const CARDS = [
  { time: 1700, type: 'question', summary: '白平衡这里没跟上', subtitle: '大家可以看到它其实是蓝色 其实在这个环境里面看到的' },
  { time: 1712, type: 'question', summary: '一边偏蓝一边偏紫的原因', subtitle: '一边偏蓝一边是偏紫' },
  { time: 1950, type: 'key', summary: '色温中间值就是正常值', subtitle: '中间值就是我们现在拍到的这个值' },
  { time: 2104, type: 'step', summary: '色温拉高给人加血色', subtitle: '把这个色温稍微调高一点' },
  { time: 2660, type: 'question', summary: '蒙版到底先点哪个', subtitle: '必须要第一个要点击它 第二个要点击需要新建蒙版的图层' },
  { time: 2682, type: 'step', summary: '钢笔工具勾一圈', subtitle: '钢笔工具其实也是一样的' },
  { time: 3100, type: 'key', summary: '三个点位坐标要记', subtitle: '这个点坐标是00 这个点的坐标是1080乘以10800' },
  { time: 3140, type: 'fix', summary: '抠图要保留绿色？这句好像讲反了', subtitle: '抠图大家知道我们应该是之前给大家讲抠图应该是要让他周围的绿色应该更均匀一些' },
  { time: 3900, type: 'question', summary: '导出分辨率写 4K 还是 1080', subtitle: '导出视频时需设置标题、分辨率' },
  { time: 3915, type: 'step', summary: '导出码率 20000-23000', subtitle: '格式（MP4）、帧率（25帧）和码率' },
  { time: 4400, type: 'key', summary: '工程文件按日期命名', subtitle: '工程文件管理与课程总结' },
  { time: 4600, type: 'case', summary: '这个交付流程可以直接抄', subtitle: '需要交给老师的是要交付给企业的' },
];

function line(label, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(26)} ${extra}`);
  return ok;
}

function clearNotes() {
  if (fs.existsSync(NOTES_FILE)) fs.unlinkSync(NOTES_FILE);
}

async function main() {
  clearNotes();

  for (const [index, card] of CARDS.entries()) {
    const body = {
      id: `verify-${index + 1}`,
      channelId: CHANNEL,
      videoKey: VIDEO_KEY,
      type: card.type,
      time: card.time,
      duration: 4900,
      subtitle: card.subtitle,
      summary: card.summary,
      visitorId: `verify-v${(index % 4) + 1}`,
      createdAt: new Date().toISOString(),
    };
    const response = await fetch(`${BASE}/api/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`上报失败 ${response.status}: ${await response.text()}`);
  }

  const stored = fs.readFileSync(NOTES_FILE, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  let pass = 0;
  let total = 0;

  total++;
  if (line('落盘条数', stored.length === CARDS.length, `${stored.length}/${CARDS.length}`)) pass++;

  total++;
  const zh = stored.some((n) => n.summary.includes('白平衡'));
  if (line('中文未被转义破坏', zh, stored[0]?.summary ?? '')) pass++;

  const report = await (
    await fetch(`${BASE}/api/teacher/${encodeURIComponent(VIDEO_KEY)}?channelId=${CHANNEL}`)
  ).json();

  total++;
  if (line('教师端读到卡片', report.scale?.cards === CARDS.length, `${report.scale?.cards} 张`)) pass++;

  total++;
  if (line('观众人数去重', report.scale?.viewers === 4, `${report.scale?.viewers} 人`)) pass++;

  total++;
  const types = Object.keys(report.scale?.byType ?? {});
  if (line('5 类标签都在', ['key', 'question', 'step', 'case', 'fix'].every((t) => types.includes(t)), types.join(','))) pass++;

  total++;
  if (line('官方章节聚合', (report.scale?.chapters ?? 0) >= 4, `${report.scale?.chapters} 段`)) pass++;

  total++;
  const realChapter = (report.chapters ?? []).some((c) => c.topic.includes('AE') || c.topic.includes('调色'));
  if (line('章节名来自官方大纲', realChapter, (report.chapters ?? []).map((c) => c.topic).join(' / ').slice(0, 60))) pass++;

  total++;
  if (line('热点区段', (report.hotspots ?? []).length >= 1, `${report.hotspots?.length} 个`)) pass++;

  total++;
  const hasEvidence = (report.findings ?? []).every((f) => Array.isArray(f.evidence) && f.evidence.length > 0);
  if (line('每条诊断都带证据', hasEvidence, `${report.findings?.length} 条`)) pass++;

  total++;
  if (line('sessionId 对齐场次号', report.sessionId === 'hcvi46hzlg', report.sessionId)) pass++;

  total++;
  if (line('网格 5 行', (report.grid?.rows ?? []).length === 5, `${report.grid?.rows?.length} 行`)) pass++;

  console.log(`\n热点：${(report.hotspots ?? []).map((h) => `${h.id} ${Math.round(h.t0 / 60)}'${h.chapter}`).join(' | ')}`);
  console.log(`结论：${report.verdict}`);
  console.log(`${pass}/${total} 项通过`);

  if (!keep) clearNotes();
  process.exit(pass === total ? 0 : 1);
}

main().catch((error) => {
  console.error('ERR', error.message);
  process.exit(1);
});
