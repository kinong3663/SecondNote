import { readFileSync } from 'node:fs';
import { detectDrops, completeness, segmentRisks, fmtTime, peakOf } from '../src/analysis';
import { renderTimeline, renderSpark, renderTopicBars } from '../src/chart';

const J = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

const sessions = J('public/data/contract/sessions.json').sessions;
const byId = (id: string) => sessions.find((s: any) => s.sessionId === id);

for (const id of ['hcg2c6sp48', 'h5dgpf2llu']) {
  const session = byId(id);
  const curve = J(`public/data/contract/curves/${id}.json`);
  const topics = null;
  const inter = J(`public/data/contract/interactions/${id}.json`);
  const det = detectDrops(curve, topics, inter);
  const comp = completeness(session, curve, topics, inter);
  const svg = renderTimeline({ curve, topics, events: inter.events, drops: det.drops });
  console.log(`\n[${id}] ${fmtTime(0)} 峰值 ${peakOf(curve.points)} · 点 ${curve.points.length}`);
  console.log(`  drops=${det.drops.length} gated=${det.gated} ${det.reason ?? ''}`);
  det.drops.forEach((d) => console.log(`   #${fmtTime(d.tStart)}-${fmtTime(d.tEnd)} ${d.from}→${d.to} ${(d.drop*100).toFixed(1)}% ${d.cause}`));
  console.log(`  完整度 ${comp.tier} 缺:${comp.missing.join(',') || '无'}`);
  console.log(`  SVG ${svg.length} 字节, 含 path=${svg.includes('<path')}, rect=${svg.includes('<rect')}`);
  console.log(`  spark ${renderSpark(curve.points).length}B`);
}

const t = J('public/data/contract/topics/vod_bfcb278e7a88e2d51e23ba453596ddf2_b.json');
const risks = segmentRisks(t);
const bars = renderTopicBars(t, risks);
const high = risks.filter((r) => r.level === 'high').length;
console.log(`\n[话题] ${t.segments.length} 段 · 高危 ${high} · bars ${bars.length}B`);
console.log(`  最高危: ${risks.filter(r=>r.level==='high').slice(0,3).map(r=>fmtTime(r.segment.startSec)+' '+r.segment.topic.slice(0,14)).join(' | ')}`);

