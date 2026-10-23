/**
 * ReLive · 彩排评分卡（PRD §4 实现）
 *
 * 输入：public/data/history.json（上一场三线数据 + 分段）、public/data/script.json（本次台本）
 * 输出：public/data/rehearsal-report.json（+ --fix 时额外输出 rehearsal-report-fixed.json）
 *
 * 判断全部由规则 + 历史基线完成，不调用大模型 —— 保证可复现、可解释、现场不翻车。
 * LLM 只负责把结论润色成能念的话（buildAdvice 的模板槽位）。
 *
 * 用法：
 *   node scripts/score.mjs         只出报告
 *   node scripts/score.mjs --fix   出报告 + 把建议插进台本重跑，打印改前/改后对比（demo 第 5 步）
 */
import fs from 'node:fs';
import path from 'node:path';

const DATA = path.join(process.cwd(), 'public', 'data');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

const history = read('history.json');
const script = read('script.json');

const HOOK_RE = /[？?]|扣\s*个?\s*1|打在公屏|公屏上|抽奖|投票|评论区|报个数|举手|福利|你们看|大家看/;
const HOOK_GAP_LIMIT_MIN = 3;   // 超过 3 分钟没有钩子就报警
const DENSITY_MIN = 1.2;        // 每分钟要点数下限（台本是提纲，低于它说明这段"没东西"）
const DENSITY_MAX = 4.0;        // 上限（超过说明信息过载，观众消化不了）
const BASELINE_DROP_NORM = 0.15;

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const round4 = (v) => Number(v.toFixed(4));
const mmss = (s) => `${Math.floor(s / 60)}'${String(Math.floor(s % 60)).padStart(2, '0')}"`;

/** 某时间窗内的观测掉人率 */
function observedDrop(startSec, endSec) {
  const w = history.series.filter((p) => p.t >= startSec && p.t <= endSec);
  if (w.length < 2) return 0;
  return (w.at(-1).online - w[0].online) / w[0].online;
}

/** 某时间窗内的平均弹幕强度（条 / 采样桶） */
function observedChat(startSec, endSec) {
  const w = history.series.filter((p) => p.t >= startSec && p.t <= endSec);
  return w.length ? w.reduce((s, p) => s + p.chat, 0) / w.length : 0;
}

/** 找历史同主题段落 → 这条建议的证据 */
function findEvidence(topic) {
  const hit =
    history.segments.find((s) => s.topic === topic) ??
    history.segments.find((s) => topic.includes(s.topic) || s.topic.includes(topic));
  if (!hit) return null;
  return {
    topic: hit.topic,
    startSec: hit.startSec,
    endSec: hit.endSec,
    observedDrop: round4(observedDrop(hit.startSec, hit.endSec)),
    chatPerBucket: Number(observedChat(hit.startSec, hit.endSec).toFixed(2)),
  };
}

/** 要点数：按标点切分，数字/专有名词计 1.5 个要点 */
function countPoints(text) {
  const clauses = text.split(/[，。；！？、,;!?]/).filter((c) => c.trim().length > 1);
  const numbers = (text.match(/\d+/g) || []).length;
  const proper = (text.match(/[A-Z]{2,}|AI|ROI|SDK/g) || []).length;
  return clauses.length + numbers * 0.5 + proper * 0.5;
}

/** 段落风险与建议 */
function scoreSegment(seg, prevSeg) {
  const durSec = seg.endSec - seg.startSec;
  const minutes = durSec / 60;
  const points = countPoints(seg.text);
  const density = points / minutes;

  const hasHook = HOOK_RE.test(seg.text);
  const prevHook = prevSeg ? HOOK_RE.test(prevSeg.text) : false;
  const gapMin = hasHook
    ? 0
    : minutes + (prevHook || !prevSeg ? 0 : (prevSeg.endSec - prevSeg.startSec) / 60);

  const ev = findEvidence(seg.topic);
  const baselineDrop = ev ? Math.min(0, ev.observedDrop) : -0.06;

  const hookPenalty = clamp(gapMin / HOOK_GAP_LIMIT_MIN);
  const baselinePenalty = clamp(Math.abs(baselineDrop) / BASELINE_DROP_NORM);
  const densityPenalty = density < DENSITY_MIN
    ? clamp((DENSITY_MIN - density) / DENSITY_MIN)
    : density > DENSITY_MAX
      ? clamp((density - DENSITY_MAX) / DENSITY_MAX)
      : 0;
  const hitKeywords = script.keywords.filter((k) => seg.text.includes(k));
  const keywordRate = hitKeywords.length / script.keywords.length;

  const risk = clamp(
    0.45 * hookPenalty +
    0.35 * baselinePenalty +
    0.10 * densityPenalty +
    0.10 * (1 - keywordRate),
  );

  // 有钩子的段落，历史基线掉人会明显缓解（0.45 ≈ 我们观察到的缓解比例）
  const expectDrop = round4(baselineDrop * (hasHook ? 0.55 : 1) - (hasHook ? 0.01 : 0));

  return {
    id: seg.id,
    topic: seg.topic,
    startSec: seg.startSec,
    endSec: seg.endSec,
    startMs: seg.startSec * 1000,
    endMs: seg.endSec * 1000,
    risk: round4(risk),
    metrics: {
      expectDrop,
      hasHook,
      hookGapMin: Number(gapMin.toFixed(1)),
      density: Number(density.toFixed(2)),
      points: Math.round(points * 10) / 10,
      durationMin: Number(minutes.toFixed(1)),
      keywordHit: `${hitKeywords.length}/${script.keywords.length}`,
      missedKeywords: script.keywords.filter((k) => !seg.text.includes(k)),
    },
    evidence: ev,
    problem: describe({ gapMin, density, hasHook, hitKeywords, baselineDrop }),
    advice: buildAdvice({ seg, gapMin, density, missed: script.keywords.filter((k) => !seg.text.includes(k)) }),
  };
}

function describe({ gapMin, density, hasHook, hitKeywords, baselineDrop }) {
  const parts = [];
  if (gapMin >= HOOK_GAP_LIMIT_MIN) parts.push(`连续 ${gapMin.toFixed(1)} 分钟没有互动钩子`);
  else if (!hasHook) parts.push('整段没有互动钩子');
  if (density < DENSITY_MIN) parts.push(`要点密度偏低（${density.toFixed(1)} 点/分钟，占着时长但没有信息量）`);
  if (density > DENSITY_MAX) parts.push(`信息过载（${density.toFixed(1)} 点/分钟）`);
  if (!hitKeywords.length) parts.push('缺少关键信息');
  if (!parts.length) parts.push('节奏与信息密度正常');
  const dropText = baselineDrop < 0
    ? `预计本段流失 ${(Math.abs(baselineDrop) * 100).toFixed(1)}%`
    : '预计本段基本持平';
  return `${parts.join('，')}。按历史基线${dropText}。`;
}

/** 按主题给一句能直接念的话（模板 + 槽位，LLM 只做润色） */
function pickQuestion(topic) {
  const bank = [
    { k: '价格', q: '你们今年的直播预算是挂在市场还是挂在采购？扣 1 的按市场讲，扣 2 的按采购讲。' },
    { k: '服务', q: '你们现在有几个人是专岗做直播的？一个的扣 1，两个以上的扣 2。' },
    { k: '产品', q: '你们现在团队里有几个人在管直播？打在公屏上，我按人数决定讲多深。' },
    { k: '演示', q: '猜一下，刚才那段人掉得最多的是哪一刻？打在公屏上，看看有没有人跟我一样。' },
    { k: '案例', q: '你们行业里有没有见过做得特别好的直播？打在公屏上，我看看能不能对上号。' },
  ];
  const hit = bank.find((b) => topic.includes(b.k));
  return hit ? hit.q : '你们现在团队里有几个人在管直播？打在公屏上，我看看要不要展开讲。';
}

function buildAdvice({ seg, gapMin, density, missed }) {
  if (gapMin >= HOOK_GAP_LIMIT_MIN) {
    return `在这段开头插一句提问，把观众从「听」拉回「说」：「在讲${seg.topic}之前先问一下——${pickQuestion(seg.topic)}」然后停 8 秒等弹幕（停顿写进台本备注，别临场找）。`;
  }
  if (density < DENSITY_MIN) {
    return `这段 ${(seg.endSec - seg.startSec) / 60} 分钟里只有 ${Math.round(countPoints(seg.text))} 个信息点，太空。要么压到一半时长，要么补一个具体数字（客户案例/实测数据），别用形容词填时间。`;
  }
  if (density > DENSITY_MAX) {
    return `信息太密，观众消化不了。拆成两段，中间插一句「我停一下，刚才这两个点哪个更急？」。`;
  }
  if (missed.length) {
    return `补一句跟「${missed[0]}」相关的具体信息（观众最常追问这个），一句话就够，别展开成新段落。`;
  }
  return '这段没问题，保留。';
}

/** 把建议真正插进台本（demo 第 5 步：改后重跑） */
function applyFix(src) {
  const copy = JSON.parse(JSON.stringify(src));
  for (const seg of copy.segments) {
    if (!HOOK_RE.test(seg.text)) {
      seg.text = `（开场提问）${pickQuestion(seg.topic)}` + seg.text;
    }
  }
  return copy;
}

// ---------- 主流程 ----------
const scored = script.segments.map((seg, i) => scoreSegment(seg, script.segments[i - 1]));
const avgRisk = round4(scored.reduce((s, x) => s + x.risk, 0) / scored.length);
const predictedRetention = round4(scored.reduce((acc, s) => acc * (1 + s.metrics.expectDrop), 1));

const report = {
  meta: {
    title: script.meta.title,
    channelId: script.meta.channelId,
    baselineFrom: `${history.meta.title}（${history.meta.date}）`,
    baselineSource: history.meta.source,
    generatedAt: new Date().toISOString(),
    engine: 'rule+baseline v1',
  },
  overallScore: Math.round((1 - avgRisk) * 100),
  avgRisk,
  predictedRetention,
  segments: scored,
  risks: [...scored].sort((a, b) => b.risk - a.risk).slice(0, 3),
};

fs.writeFileSync(path.join(DATA, 'rehearsal-report.json'), JSON.stringify(report, null, 2), 'utf8');

console.log(`\n彩排：${report.meta.title}`);
console.log(`基线：${report.meta.baselineFrom} · ${report.meta.baselineSource}`);
console.log(`总分 ${report.overallScore} · 预测整体留存 ${(predictedRetention * 100).toFixed(1)}%\n`);

for (const s of scored) {
  const bar = '█'.repeat(Math.round(s.risk * 20)).padEnd(20, '·');
  console.log(`${bar} ${String(Math.round(s.risk * 100)).padStart(3)}  ${mmss(s.startSec)}-${mmss(s.endSec).padEnd(8)} ${s.topic}`);
}

console.log('\n=== Top3 风险 ===');
for (const r of report.risks) {
  console.log(`\n▸ ${r.topic}  ${mmss(r.startSec)}-${mmss(r.endSec)}  risk=${r.risk}`);
  console.log(`  问题：${r.problem}`);
  console.log(
    r.evidence
      ? `  证据：上一场「${r.evidence.topic}」${mmss(r.evidence.startSec)}-${mmss(r.evidence.endSec)}，实测 ${(r.evidence.observedDrop * 100).toFixed(1)}%，弹幕 ${r.evidence.chatPerBucket} 条/桶`
      : '  证据：无同类历史段落，用类目基线',
  );
  console.log(`  建议：${r.advice}`);
}

// ---------- 改后重跑 ----------
if (process.argv.includes('--fix')) {
  const fixed = applyFix(script);
  const after = fixed.segments.map((seg, i) => scoreSegment(seg, fixed.segments[i - 1]));
  const retentionAfter = round4(after.reduce((acc, s) => acc * (1 + s.metrics.expectDrop), 1));
  const riskAfter = round4(after.reduce((s, x) => s + x.risk, 0) / after.length);

  const out = {
    meta: { ...report.meta, variant: 'fixed' },
    overallScore: Math.round((1 - riskAfter) * 100),
    avgRisk: riskAfter,
    predictedRetention: retentionAfter,
    segments: after,
  };
  fs.writeFileSync(path.join(DATA, 'rehearsal-report-fixed.json'), JSON.stringify(out, null, 2), 'utf8');

  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  console.log('\n=== 改后重跑（每段开头插入提问） ===');
  console.log(`预测留存  ${pct(predictedRetention)} → ${pct(retentionAfter)}   (+${((retentionAfter - predictedRetention) * 100).toFixed(1)}pp)`);
  console.log(`风险均分  ${pct(avgRisk)} → ${pct(riskAfter)}`);
  console.log(`总分      ${report.overallScore} → ${out.overallScore}`);
  const worst = report.risks[0];
  const worstAfter = after.find((s) => s.id === worst.id);
  console.log(`最危险段「${worst.topic}」risk ${worst.risk} → ${worstAfter.risk}`);
  console.log('\n✅ public/data/rehearsal-report.json');
  console.log('✅ public/data/rehearsal-report-fixed.json');
} else {
  console.log('\n✅ public/data/rehearsal-report.json');
}
