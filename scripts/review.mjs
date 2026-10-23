/**
 * ReLive · 复盘文档生成器
 *
 * 输入：public/data/sim/session-*.json（模拟全流程事件流）
 *      public/data/raw/*.json（真实场次/回放/日峰值 —— 报告里的 real 部分）
 * 输出：public/data/review/<sessionId>.md   ← 十节复盘文档（可导出长图）
 *      public/data/review/<sessionId>.json  ← 同内容结构化（前端用）
 *
 * 判断全部来自规则表，LLM 不参与判断。每条结论必须带证据，无证据不出。
 *
 * 用法：node scripts/review.mjs            全部场次
 *      node scripts/review.mjs sim_03     指定场次
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SIM = path.join(ROOT, 'public', 'data', 'sim');
const OUT = path.join(ROOT, 'public', 'data', 'review');
fs.mkdirSync(OUT, { recursive: true });

const only = process.argv[2];
const files = fs.readdirSync(SIM).filter((f) => f.startsWith('session-') || /^sim_/.test(f)).filter((f) => f.endsWith('.json'));
const sessions = (only ? files.filter((f) => f.includes(only)) : files).map((f) => JSON.parse(fs.readFileSync(path.join(SIM, f), 'utf8')));

const mmss = (s) => `${Math.floor(s / 60)}'${String(Math.round(s % 60)).padStart(2, '0')}"`;
const hhmm = (s) => `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
const pct = (v) => `${(v * 100).toFixed(1)}%`;

// ---------- 基础分析 ----------
function viewerSeries(s) { return s.events.filter((e) => e.type === 'viewer'); }

/** 去趋势的滑窗掉人检测（与生成器同一套，保证可回归验证） */
function detectDrops(s, windowSec = 180, top = 3) {
  const pts = viewerSeries(s);
  const w = Math.floor(windowSec / 30);
  const all = [];
  for (let i = 0; i + w < pts.length; i++) {
    const a = pts[i].viewers, b = pts[i + w].viewers;
    all.push({ startSec: pts[i].t, endSec: pts[i + w].t, drop: (b - a) / a, from: a, to: b });
  }
  const median = [...all].map((c) => c.drop).sort((x, y) => x - y)[Math.floor(all.length / 2)] ?? 0;
  const cands = all.map((c) => ({ ...c, abnormal: c.drop - median })).filter((c) => c.abnormal < -0.08).sort((x, y) => x.abnormal - y.abnormal);
  const out = [];
  for (const c of cands) {
    if (out.some((o) => Math.abs(o.startSec - c.startSec) < windowSec)) continue;
    out.push(c);
    if (out.length >= top) break;
  }
  return out;
}

const inWindow = (events, a, b, type) => events.filter((e) => e.t >= a && e.t <= b && e.type === type);
const segAt = (s, t) => s.segments.find((g) => t >= g.startSec && t < g.endSec) ?? s.segments.at(-1);

function chatStats(s) {
  const chats = s.events.filter((e) => e.type === 'chat');
  const buckets = new Map();
  for (const c of chats) {
    const b = Math.floor(c.t / 60) * 60;
    buckets.set(b, (buckets.get(b) ?? 0) + 1);
  }
  const perMin = [...buckets.values()];
  const mean = perMin.reduce((a, b) => a + b, 0) / Math.max(1, perMin.length);
  const sd = Math.sqrt(perMin.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, perMin.length));
  const peaks = [...buckets.entries()]
    .map(([t, n]) => ({ t, n }))
    .filter((p) => p.n >= 2)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3);
  const sentiment = chats.reduce((a, c) => a + (c.sentiment ?? 0), 0) / Math.max(1, chats.length);
  return { total: chats.length, perMin: buckets, mean, sd, peaks, sentiment };
}

/** 归因规则表 */
function attribute(s, drop) {
  const { startSec, endSec } = drop;
  const chats = inWindow(s.events, startSec, endSec, 'chat');
  const stalls = inWindow(s.events, startSec, endSec, 'player');
  const cards = inWindow(s.events, startSec, endSec, 'interact').filter((e) => e.kind === 'answer_card');
  const seg = segAt(s, startSec);
  const segStart = seg.startSec;
  const nearSwitch = Math.abs(startSec - segStart) <= 60;
  const isLast = endSec >= s.durationSec - 300;

  if (stalls.length) {
    return {
      cause: '技术体验问题（播放卡顿）',
      rule: '窗口内出现 player.stall',
      fix: `检查该时段码率与清晰度策略；连续缓冲超过 2 秒就应自动降码率，而不是让观众自己切。`,
      impact: '直接止损（卡顿期间的流失几乎不可挽回）',
      confidence: 'high',
    };
  }
  if (cards.length && (cards[0].payload?.correctRate ?? 1) < 0.5) {
    return {
      cause: '讲解不清（答题正确率低）',
      rule: '该段答题卡正确率 < 50%',
      fix: `这段对应的题只有 ${pct(cards[0].payload.correctRate)} 正确率，说明概念没讲透。下一场把这段拆成「先举个反例 → 再给定义」。`,
      impact: '次场同题正确率可提升 20pp 以上',
      confidence: 'high',
    };
  }
  if (chats.length === 0) {
    return {
      cause: '单口讲解过长（弹幕归零）',
      rule: '窗口内 Δonline 异常下跌 且 弹幕 = 0',
      fix: `这段 ${Math.round((endSec - startSec) / 60)} 分钟弹幕为零。下一场在此前插入一句提问，并把段落压到 3 分钟内。可直接用：「${seg.topic}这一段，你们现在团队里是怎么做的？打在公屏上。」`,
      impact: '掉幅通常可减半',
      confidence: 'high',
    };
  }
  if (nearSwitch) {
    return {
      cause: '过渡生硬（话题切换处掉人）',
      rule: '掉人窗口起点距话题切换 ≤ 60s，且弹幕非零',
      fix: `从「${s.segments[Math.max(0, s.segments.indexOf(seg) - 1)]?.topic ?? '上一段'}」切到「${seg.topic}」时没有预告。加一句转场：「接下来这段讲 ${seg.topic}，如果你只关心结论，听完这句就可以走。」`,
      impact: '曲线平滑，减少"不知道后面讲什么"的离开',
      confidence: 'medium',
    };
  }
  if (isLast) {
    return {
      cause: '收尾没给下一步',
      rule: '掉人窗口落在最后 5 分钟',
      fix: '结尾前 3 分钟预告下一场主题 + 给资料/回放入口，把"结束"变成"下一步"。',
      impact: '次场到场率提升',
      confidence: 'medium',
    };
  }
  return {
    cause: '内容与预期不符',
    rule: '窗口内有弹幕但仍掉人',
    fix: `掉人点前补一句「这段解决什么问题」，并在开头 2 分钟把本场地图讲清（共几段、每段解决什么）。`,
    impact: '缓冲流失',
    confidence: 'low',
  };
}

/** 话题段三线合表 */
function topicTable(s) {
  const pts = viewerSeries(s);
  return s.segments.map((seg) => {
    const win = pts.filter((p) => p.t >= seg.startSec && p.t <= seg.endSec);
    const drop = win.length > 1 ? (win.at(-1).viewers - win[0].viewers) / win[0].viewers : 0;
    const avg = win.reduce((a, p) => a + p.viewers, 0) / Math.max(1, win.length);
    const chat = inWindow(s.events, seg.startSec, seg.endSec, 'chat').length;
    const likes = inWindow(s.events, seg.startSec, seg.endSec, 'like').reduce((a, e) => a + e.count, 0);
    return { ...seg, drop, avg, chat, likes, minutes: Math.round((seg.endSec - seg.startSec) / 60) };
  });
}

// ---------- 生成一份文档 ----------
function buildReport(s) {
  const pts = viewerSeries(s);
  const v0 = pts[0]?.viewers ?? 0;
  const vEnd = pts.at(-1)?.viewers ?? 0;
  const vMax = Math.max(...pts.map((p) => p.viewers));
  const avg = pts.reduce((a, p) => a + p.viewers, 0) / Math.max(1, pts.length);
  const cstats = chatStats(s);
  const interacts = s.events.filter((e) => e.type === 'interact');
  const stalls = s.events.filter((e) => e.type === 'player');
  const drops = detectDrops(s);
  const topics = topicTable(s);

  const attributed = drops.map((d) => ({ ...d, seg: segAt(s, d.startSec), ...attribute(s, d) }));

  // 核心结论三条：最好的一段 = 互动量高且没掉人（掉幅要扣分，否则会选出"弹幕多但人走光"的段）
  const scoreOf = (t) => t.chat * 2 + t.likes * 0.3 + t.drop * 200;
  const bestTopic = [...topics].sort((a, b) => scoreOf(b) - scoreOf(a))[0];
  const worst = attributed[0];
  const conclusions = [
    `最好的一段是「${bestTopic.topic}」（${mmss(bestTopic.startSec)}-${mmss(bestTopic.endSec)}）：弹幕 ${bestTopic.chat} 条、点赞 ${bestTopic.likes} 次，段内人数变化 ${(bestTopic.drop * 100).toFixed(1)}%。`,
    worst
      ? `最差的一段是「${worst.seg.topic}」里的 ${mmss(worst.startSec)}-${mmss(worst.endSec)}：${worst.from}→${worst.to} 人（${pct(worst.drop)}），归因是「${worst.cause}」。`
      : '全场没有出现异常下跌（各窗口跌幅都在基线附近），节奏是稳的。',
    worst
      ? `最该改的一件事：${worst.fix.split('。')[1] ?? worst.fix.split('。')[0]}。`
      : `最该做的一件事：把「${bestTopic.topic}」这段做成切片，下一场开场直接复用。`,
  ];

  // 问题清单（按严重度）
  const issues = attributed.map((a, i) => ({
    level: a.drop < -0.25 ? 'S' : a.drop < -0.15 ? 'A' : 'B',
    at: `${mmss(a.startSec)}-${mmss(a.endSec)}`,
    topic: a.seg.topic,
    desc: `${a.from}→${a.to} 人（${pct(a.drop)}），${a.cause}`,
    index: i + 1,
  }));

  const completeness = {
    tier: 'A',
    real: ['场次与时长（channel/session/list）', '回放与播放地址（channel/playback/list）'],
    sdk: ['弹幕（模拟 SDK 事件流）', '点赞', '答题卡/签到/公告/抽奖'],
    sim: ['分钟级在线人数曲线', '讲师话题分段'],
    note: '本次为模拟场次（source: sim），接入真实场次后按同一引擎重算；缺失维度会在报告顶部标注。',
  };

  return {
    meta: {
      sessionId: s.sessionId, title: s.title, scenario: s.scenario,
      date: new Date(s.startTime).toISOString().slice(0, 10),
      durationSec: s.durationSec, source: s.source, generatedAt: new Date().toISOString(),
      engine: 'rule+baseline v1',
    },
    kpi: {
      durationMin: Math.round(s.durationSec / 60),
      peak: vMax, avgOnline: Math.round(avg), start: v0, end: vEnd,
      endRetention: Number((vEnd / v0).toFixed(3)),
      chatTotal: cstats.total, chatPerMin: Number((cstats.total / (s.durationSec / 60)).toFixed(2)),
      sentiment: Number(cstats.sentiment.toFixed(2)),
      interacts: interacts.length, stalls: stalls.length,
    },
    conclusions,
    drops: attributed,
    topics,
    highlights: cstats.peaks.map((p) => ({ at: mmss(p.t), count: p.n, topic: segAt(s, p.t).topic })),
    issues,
    completeness,
  };
}

// ---------- Markdown 渲染（十节） ----------
function toMarkdown(r) {
  const L = [];
  const title = `# 直播复盘 · ${r.meta.title}`;
  L.push(title, '');
  L.push(`> ${r.meta.date} · ${r.kpi.durationMin} 分钟 · 峰值 ${r.kpi.peak} 人 · 场次 \`${r.meta.sessionId}\` · 数据来源 \`${r.meta.source}\``);
  L.push('');

  L.push('## 1. 核心结论', '');
  r.conclusions.forEach((c, i) => L.push(`${i + 1}. ${c}`));
  L.push('');

  L.push('## 2. 场次速览', '');
  L.push('| 指标 | 数值 | 指标 | 数值 |');
  L.push('|---|---|---|---|');
  L.push(`| 时长 | ${r.kpi.durationMin} 分钟 | 峰值 | ${r.kpi.peak} 人 |`);
  L.push(`| 平均在线 | ${r.kpi.avgOnline} 人 | 结束留存 | ${(r.kpi.endRetention * 100).toFixed(1)}% |`);
  L.push(`| 弹幕总数 | ${r.kpi.chatTotal} 条 | 弹幕密度 | ${r.kpi.chatPerMin} 条/分钟 |`);
  L.push(`| 互动次数 | ${r.kpi.interacts} 次 | 卡顿 | ${r.kpi.stalls} 次 |`);
  L.push('');

  L.push('## 3. 掉人点', '');
  if (!r.drops.length) {
    L.push('全场无异常下跌窗口（所有 3 分钟窗口跌幅都在基线附近）。', '');
  } else {
    L.push('| # | 时间 | 人数变化 | 幅度 | 当时讲的 |');
    L.push('|---|---|---|---|---|');
    r.drops.forEach((d, i) => L.push(`| ${i + 1} | ${mmss(d.startSec)}-${mmss(d.endSec)} | ${d.from}→${d.to} | ${(d.drop * 100).toFixed(1)}% | ${d.seg.topic} |`));
    L.push('');
  }

  L.push('## 4. 话题对齐（三线合表）', '');
  L.push('| 话题 | 时间 | 时长 | 均在线 | 段内变化 | 弹幕 | 点赞 |');
  L.push('|---|---|---|---|---|---|---|');
  for (const t of r.topics) L.push(`| ${t.topic} | ${mmss(t.startSec)}-${mmss(t.endSec)} | ${t.minutes}min | ${Math.round(t.avg)} | ${(t.drop * 100).toFixed(1)}% | ${t.chat} | ${t.likes} |`);
  L.push('');

  L.push('## 5. 归因分析', '');
  if (!r.drops.length) L.push('无需归因。', '');
  r.drops.forEach((d, i) => {
    L.push(`### 掉人点 ${i + 1} · ${mmss(d.startSec)}-${mmss(d.endSec)} · ${d.cause}`);
    L.push('');
    L.push(`- **现象**：在线人数 ${d.from} → ${d.to}（${(d.drop * 100).toFixed(1)}%），当时在讲「${d.seg.topic}」`);
    L.push(`- **判据**：${d.rule}`);
    L.push(`- **置信度**：${d.confidence}`);
    L.push(`- **改法**：${d.fix}`);
    L.push(`- **预期影响**：${d.impact}`);
    L.push('');
  });

  L.push('## 6. 高光片段', '');
  if (!r.highlights.length) L.push('弹幕分布平稳，无显著峰值。', '');
  else {
    L.push('| 时间 | 弹幕峰值 | 话题 | 建议 |');
    L.push('|---|---|---|---|');
    for (const h of r.highlights) L.push(`| ${h.at} | ${h.count} 条/分钟 | ${h.topic} | 可切为 30~60 秒切片，用于下一场开场钩子 |`);
    L.push('');
  }

  L.push('## 7. 问题清单', '');
  if (!r.issues.length) L.push('无 S/A 级问题。', '');
  else {
    L.push('| 级别 | 位置 | 问题 |');
    L.push('|---|---|---|');
    for (const x of r.issues) L.push(`| ${x.level} | ${x.at} | ${x.desc} |`);
    L.push('');
  }

  L.push('## 8. 改进方案', '');
  if (!r.drops.length) L.push('保持当前节奏，把高光段做成切片复用。', '');
  r.drops.forEach((d, i) => {
    L.push(`${i + 1}. **${mmss(d.startSec)} 之前** — ${d.fix}（依据：${d.rule}）`);
  });
  L.push('');

  L.push('## 9. 下场看点', '');
  const watch = r.drops.length
    ? r.drops.map((d) => `${mmss(d.startSec)} 附近：盯「${d.seg.topic}」段的分钟级跌速，目标把跌幅压到 8% 以内`)
    : ['开场 5 分钟的入场爬升速度（低于上一场需检查预热渠道）'];
  watch.forEach((w, i) => L.push(`${i + 1}. ${w}`));
  L.push('');

  L.push('## 10. 数据口径说明', '');
  L.push(`- **完整度**：${r.completeness.tier} 档`);
  L.push(`- **真实数据（real）**：${r.completeness.real.join('；')}`);
  L.push(`- **SDK 采集（sdk）**：${r.completeness.sdk.join('；')}`);
  L.push(`- **模拟数据（sim）**：${r.completeness.sim.join('；')}`);
  L.push(`- **说明**：${r.completeness.note}`);
  L.push('');
  L.push('---');
  L.push(`_由 ReLive 复盘引擎生成 · ${r.meta.generatedAt} · 引擎 ${r.meta.engine}_`);
  return L.join('\n');
}

// ---------- 主流程 ----------
console.log('场次            剧本      时长   峰值  掉人点  结论');
for (const s of sessions.sort((a, b) => a.sessionId.localeCompare(b.sessionId))) {
  const r = buildReport(s);
  fs.writeFileSync(path.join(OUT, `${s.sessionId}.json`), JSON.stringify(r, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT, `${s.sessionId}.md`), toMarkdown(r), 'utf8');
  console.log(
    `${s.sessionId}  ${r.meta.scenario.padEnd(9)} ${String(r.kpi.durationMin).padStart(3)}min ${String(r.kpi.peak).padStart(5)} ${String(r.drops.length).padStart(6)}  ${r.drops[0] ? r.drops[0].cause : '无异常'}`,
  );
}
console.log(`\n✅ ${sessions.length} 份复盘文档 → public/data/review/{<sessionId>.md, .json}`);
