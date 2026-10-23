/**
 * 诊断：教师端报告要点（写到 tmp/teacher-report.md）
 * 用法：node scripts/inspect-teacher.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CONTRACT = path.join(ROOT, 'public', 'data', 'contract');
const OUT = path.join(ROOT, 'tmp', 'teacher-report.md');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const readJson = (p, fb = null) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fb);
const fmt = (s) => `${Math.floor(Math.round(s) / 60)}'${String(Math.round(s) % 60).padStart(2, '0')}"`;

const idx = readJson(path.join(CONTRACT, 'teacher', 'index.json'), { sessions: [] });
let md = '# 教师端报告要点\n\n';

for (const m of idx.sessions) {
  const r = readJson(path.join(CONTRACT, 'teacher', `${m.sessionId}.json`));
  if (!r) continue;
  md += `## ${r.sessionId}  ${r.title}\n\n`;
  md += `时长 ${r.scale.durationMin}min · 观众 ${r.scale.viewers} 人 · 卡片 ${r.scale.cards} 张 · 人均 ${r.scale.perViewer} · ${r.scale.perMin}/分钟 · 峰值 ${r.scale.peak}\n\n`;
  md += `曲线：${r.source.curve} · 章节 ${r.scale.chapters} · 格子 ${r.grid.rows[0].counts.length} · cellMax ${r.grid.cellMax}\n\n`;

  md += '### 热点\n\n';
  for (const h of r.hotspots) {
    md += `- **${h.id}** ${fmt(h.t0)}–${fmt(h.t1)} 「${h.chapter}」 ${h.cards} 张 · ${h.perMin}/分钟（${h.ratio}×）· 类型 ${JSON.stringify(h.byType)} · 曲线 ${h.curve ? `${h.curve.v0}→${h.curve.v1}` : '无'}\n`;
    for (const s of h.samples) md += `    - ${s.type} ${fmt(s.t)} 「${s.quote.slice(0, 40)}」\n`;
  }

  md += '\n### findings（当前 id / 标题）\n\n';
  for (const f of r.findings) {
    const hasAI = f.action ? 'AI' : '模板';
    md += `- \`${f.id}\` [${f.level}] (${hasAI}) ${f.title}\n`;
    md += `  - 证据：${f.evidence.map((e) => `${e.k}=${e.v}`).join(' | ')}\n`;
    md += `  - 判断：${f.judgment}\n`;
    if (f.action) md += `  - 动作：${f.action}\n`;
  }

  md += '\n### 章节\n\n| 章节 | 卡片 | /分钟 |\n|---|---|---|\n';
  for (const c of r.chapters) md += `| ${c.topic} | ${c.cards} | ${c.perMin} |\n`;
  md += '\n';
}

fs.writeFileSync(OUT, md, 'utf8');
console.log('[inspect-teacher] -> ' + OUT);
