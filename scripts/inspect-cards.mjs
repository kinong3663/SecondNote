/**
 * 诊断：把卡片分布打成人类可读的报告（写到 tmp/cards-report.md，避免控制台中文乱码）
 * 用法：node scripts/inspect-cards.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CONTRACT = path.join(ROOT, 'public', 'data', 'contract');
const OUT = path.join(ROOT, 'tmp', 'cards-report.md');
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const readJson = (p, fb = null) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fb);
const idx = readJson(path.join(CONTRACT, 'cards', 'index.json'), { sessions: [] });

let md = '# 记住卡分布诊断\n\n';
const mmss = (s) => `${Math.floor(s / 60)}'${String(Math.round(s % 60)).padStart(2, '0')}"`;

for (const meta of idx.sessions) {
  const f = readJson(path.join(CONTRACT, 'cards', `${meta.sessionId}.json`));
  const tp = readJson(path.join(CONTRACT, 'topics', `${meta.sessionId}.json`));
  if (!f) continue;
  md += `## ${meta.sessionId}  ${meta.cards} 张 / ${meta.viewers} 人\n\n`;
  md += `标题：${meta.title}\n\n`;

  // 章节分布
  const segs = [...(tp?.segments ?? [])].sort((a, b) => a.startSec - b.startSec);
  const dur = tp?.durationSec ?? 0;
  md += '| 章节 | 起 | 止 | 卡片 | key | question | step | case | fix |\n|---|---|---|---|---|---|---|---|---|\n';
  segs.forEach((sg, i) => {
    const end = i + 1 < segs.length ? segs[i + 1].startSec : dur;
    const inCh = f.cards.filter((c) => c.t >= sg.startSec - 1 && c.t < end);
    const cnt = (k) => inCh.filter((c) => c.type === k).length;
    md += `| ${sg.topic.slice(0, 18)} | ${mmss(sg.startSec)} | ${mmss(end)} | ${inCh.length} | ${cnt('key')} | ${cnt('question')} | ${cnt('step')} | ${cnt('case')} | ${cnt('fix')} |\n`;
  });

  // 每 5 分钟直方图（看是否成簇）
  const B = 300;
  const buckets = {};
  for (const c of f.cards) {
    const b = Math.floor(c.t / B) * B;
    buckets[b] = (buckets[b] ?? 0) + 1;
  }
  md += '\n每 5 分钟卡片数：\n\n```\n';
  for (let t = 0; t <= (dur || f.cards.at(-1).t); t += B) {
    const n = buckets[t] ?? 0;
    md += `${mmss(t).padStart(8)} ${String(n).padStart(3)} ${'▇'.repeat(n)}\n`;
  }
  md += '```\n\n';

  // 代表性卡片
  md += '代表性卡片（每类型 2 条）：\n\n';
  for (const ty of ['question', 'fix', 'step', 'key', 'case']) {
    const list = f.cards.filter((c) => c.type === ty).slice(0, 2);
    for (const c of list) md += `- \`${ty}\` ${mmss(c.t)} ${c.viewer} 「${c.quote.slice(0, 46)}」${c.note ? ' — ' + c.note : ''}\n`;
  }
  md += '\n';
}

fs.writeFileSync(OUT, md, 'utf8');
console.log('[inspect] -> ' + OUT);
