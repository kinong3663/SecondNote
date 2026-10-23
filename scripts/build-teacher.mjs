/**
 * 教师端报告构建 —— 把观众「记住卡」聚合成可复盘的东西
 *
 * 输入：public/data/contract/cards/<sid>.json        观众卡片（sim 或 real）
 *      public/data/contract/topics/<sid>.json        官方 AI 章节
 *      public/data/contract/curves/<sid>.json        人数曲线（可能没有）
 *      public/data/contract/sessions.json
 *      public/data/teacher/ai/<sid>.json             离线模型解读（可选，覆盖模板话术）
 * 输出：public/data/contract/teacher/<sid>.json + index.json
 *
 * 分工写死在这：数字由本脚本算（rule），判断与建议的措辞来自 ai/*.json（model）。
 * 每条 finding 都必须带 evidence，evidence 里的值必须能点开验证 —— 不许出现没有支撑的结论。
 *
 * 用法：node scripts/build-teacher.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CONTRACT = path.join(ROOT, 'public', 'data', 'contract');
const AI_DIR = path.join(ROOT, 'public', 'data', 'teacher', 'ai');

const readJson = (p, fb = null) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fb);
const writeJson = (p, o) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(o, null, 1), 'utf8');
};

const BUCKET = 120; // 2 分钟一格
const WIN = 3;      // 6 分钟滑窗
const WEIGHT = { question: 1.6, fix: 2.4, key: 1.0, step: 0.7, case: 0.5 };
const ROWS = ['question', 'fix', 'step', 'key', 'case'];
const TYPE_LABEL = { question: '疑问', fix: '疑似讲错', step: '操作步骤', key: '重点', case: '案例' };

const sessionsFile = readJson(path.join(CONTRACT, 'sessions.json'), { sessions: [] });
const sessions = sessionsFile.sessions ?? [];
const idxCards = readJson(path.join(CONTRACT, 'cards', 'index.json'), { sessions: [] });

const AREA_LABEL = {
  question: '疑问',
  fix: '存疑',
  step: '操作步骤',
  key: '重点',
  case: '案例',
};

const TEMPLATE = {
  question: '追问最密集的一段 —— 观众不是没听，是这里需要更细的拆解。',
  fix: '存疑卡片集中在这段，需要讲师逐条核对。',
  step: '大家想照着做，说明这段是操作演示 —— 缺的是可执行的清单，不是再听一遍。',
  key: '被当作重点反复标记，这段可以直接沉淀成课后复习题。',
  case: '案例被反复标记，说明观众想把它搬回自己的场景。',
};

const index = [];
const log = [];

for (const meta of idxCards.sessions ?? []) {
  const sid = meta.sessionId;
  const cardsFile = readJson(path.join(CONTRACT, 'cards', `${sid}.json`));
  if (!cardsFile) continue;
  const cards = cardsFile.cards ?? [];
  if (!cards.length) continue;

  const s = sessions.find((x) => x.sessionId === sid) ?? null;
  const topics = readJson(path.join(CONTRACT, 'topics', `${sid}.json`));
  const curve = readJson(path.join(CONTRACT, 'curves', `${sid}.json`)) ?? readJson(path.join(CONTRACT, 'curve', `${sid}.json`));

  const duration = topics?.durationSec ?? Math.max(...cards.map((c) => c.t)) + 300;

  // ---------- 章节有效分区（官方章节有重叠，按 start 递增切）----------
  const segs = [...(topics?.segments ?? [])].sort((a, b) => a.startSec - b.startSec);
  const chapters = segs.map((sg, i) => ({
    id: sg.id,
    topic: sg.topic,
    t0: sg.startSec,
    t1: i + 1 < segs.length ? segs[i + 1].startSec : duration,
  }));

  const inCh = (t, ch) => t >= ch.t0 - 1 && t < ch.t1;
  const covered0 = chapters.length ? chapters[0].t0 : 0;
  const covered1 = chapters.length ? chapters[chapters.length - 1].t1 : duration;

  // ---------- 网格 ----------
  const nb = Math.max(1, Math.ceil(duration / BUCKET));
  const grid = ROWS.map((type) => ({ type, counts: new Array(nb).fill(0) }));
  const totals = new Array(nb).fill(0);
  const weightAt = new Array(nb).fill(0);

  for (const c of cards) {
    const b = Math.min(nb - 1, Math.max(0, Math.floor(c.t / BUCKET)));
    const row = grid.find((r) => r.type === c.type);
    if (row) row.counts[b] += 1;
    totals[b] += 1;
    weightAt[b] += WEIGHT[c.type] ?? 1;
  }

  const cellMax = Math.max(1, ...grid.flatMap((r) => r.counts));
  const perMin = cards.length / Math.max(1, (covered1 - covered0) / 60);

  // ---------- 章节汇总 ----------
  const chapterRows = chapters.map((ch) => {
    const list = cards.filter((c) => inCh(c.t, ch));
    const byType = {};
    for (const c of list) byType[c.type] = (byType[c.type] ?? 0) + 1;
    const minutes = (ch.t1 - ch.t0) / 60;
    return {
      ...ch,
      minutes: Number(minutes.toFixed(1)),
      cards: list.length,
      byType,
      perMin: Number((list.length / Math.max(0.1, minutes)).toFixed(2)),
    };
  });

  // ---------- 热点：6 分钟滑窗 → 非极大值抑制 → 相邻合并成区段 ----------
  const curvePeak = curve ? Math.max(...curve.points.map((p) => p.v)) : 0;
  // 两个闸门分开：
  //   show   —— 曲线够密就画出来给人看
  //   usable —— 峰值够高才允许参与判断（9 个人从 6 掉到 5 是噪声，不叫掉人）
  const curveShow = !!curve && curve.points.length >= 20;
  const curveUsable = curveShow && curvePeak >= 20;

  const winScores = [];
  const S = new Array(nb).fill(0);
  for (let i = 0; i + WIN <= nb; i++) {
    let score = 0;
    for (let k = i; k < i + WIN; k++) score += weightAt[k];
    S[i] = score;
    if (score > 0) winScores.push({ i, score: Number(score.toFixed(2)) });
  }
  const maxS = Math.max(...S, 0);
  // 阈值 = 最热窗的 40%：长而稀的段混不进来，也不会只挑出一个孤立点
  const T = maxS * 0.4;

  // 连续超过阈值的窗 → 一个热点区段
  const runs = [];
  let cur = null;
  for (let i = 0; i < nb; i++) {
    const hot = S[i] > 0 && S[i] >= T;
    if (hot) {
      if (cur) cur.i1 = i;
      else cur = { i0: i, i1: i };
    } else if (cur) {
      runs.push(cur);
      cur = null;
    }
  }
  if (cur) runs.push(cur);

  const picked = runs
    .map((r) => {
      let i0 = r.i0;
      let i1 = Math.min(nb - 1, r.i1 + WIN - 1);
      // 区段过宽就收到最热的 6 分钟附近（最多约 12 分钟），否则「热点」失去意义
      if (i1 - i0 + 1 > WIN + 1) {
        let best = i0;
        for (let i = i0; i <= i1; i++) if (S[i] > S[best]) best = i;
        i0 = Math.max(i0, best - 1);
        i1 = Math.min(i1, best + WIN - 2);
      }
      const counts = { question: 0, fix: 0, step: 0, key: 0, case: 0 };
      let n = 0;
      let score = 0;
      for (let k = i0; k <= i1; k++) {
        n += totals[k];
        score += weightAt[k];
        for (const r2 of grid) counts[r2.type] += r2.counts[k];
      }
      return { t0: i0 * BUCKET, t1: Math.min(duration, (i1 + 1) * BUCKET), n, counts, score: Number(score.toFixed(2)) };
    })
    .filter((x) => x.n > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const nearest = (t) => {
    const pts = curve?.points ?? [];
    if (!pts.length) return null;
    return pts.reduce((best, p) => (Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best), pts[0]);
  };

  const hotspots = picked.map((w, i) => {
    const ch = chapterRows.find((c) => w.t0 >= c.t0 - 1 && w.t0 < c.t1) ?? null;
    // 样例按台词去重：同一条字幕被 4 个人标记，只展示一次
    const samples = [];
    const seenQuote = new Set();
    for (const c of cards
      .filter((c) => c.t >= w.t0 && c.t < w.t1)
      .sort((a, b) => (WEIGHT[b.type] ?? 1) - (WEIGHT[a.type] ?? 1))) {
      const fp = c.quote.slice(0, 12);
      if (seenQuote.has(fp)) continue;
      seenQuote.add(fp);
      samples.push({ id: c.id, t: c.t, type: c.type, quote: c.quote, viewer: c.viewer, note: c.note ?? '' });
      if (samples.length >= 5) break;
    }
    const minutes = (w.t1 - w.t0) / 60;
    const v0 = nearest(w.t0);
    const v1 = nearest(w.t1);
    const share = {};
    for (const [k, v] of Object.entries(w.counts)) if (v) share[k] = Number((v / w.n).toFixed(3));
    return {
      id: `hs${i + 1}`,
      rank: i + 1,
      t0: w.t0,
      t1: w.t1,
      chapterId: ch?.id ?? null,
      chapter: ch?.topic ?? null,
      cards: w.n,
      byType: w.counts,
      share,
      score: w.score,
      perMin: Number((w.n / minutes).toFixed(2)),
      ratio: Number((w.n / minutes / Math.max(0.01, perMin)).toFixed(2)),
      curve: curveUsable && v0 && v1 ? { v0: v0.v, v1: v1.v, delta: v1.v - v0.v, peak: curvePeak } : null,
      samples,
    };
  });

  // ---------- 沉默段：章节 ≥ 10 分钟且几乎没卡片 ----------
  const silences = chapterRows
    .filter((c) => c.minutes >= 10 && c.perMin < Math.max(0.15, perMin * 0.4))
    .map((c) => ({ chapterId: c.id, chapter: c.topic, t0: c.t0, t1: c.t1, minutes: c.minutes, cards: c.cards }));

  // ---------- 内容线缺口：官方大纲没覆盖的时长 ----------
  const gaps = [];
  if (covered0 > 300) gaps.push({ kind: 'head', t0: 0, t1: covered0, minutes: Math.round(covered0 / 60), note: '开场这段官方 AI 大纲没有生成章节，观众卡片也无法归章，复盘时需要人工指定主题' });
  if (duration - covered1 > 300) gaps.push({ kind: 'tail', t0: covered1, t1: duration, minutes: Math.round((duration - covered1) / 60), note: '结尾这段没有章节' });

  // ---------- findings ----------
  const findings = [];
  progress: for (const hs of hotspots) {
    const arc = `「${hs.chapter ?? '未归章'}」${fmt(hs.t0)}–${fmt(hs.t1)}`;
    if (hs.curve && hs.curve.delta <= -2 && hs.curve.peak >= 20) {
      findings.push({
        id: `${hs.id}-drop`,
        kind: 'hotspot-drop',
        level: 'high',
        t0: hs.t0,
        t1: hs.t1,
        title: `最多人标记，同时在掉人 · ${arc}`,
        evidence: [
          { k: '卡片', v: `${hs.cards} 张（全场均值 ${hs.perMin.toFixed(1)}/分钟，这里 ${hs.perMin}/分钟，${hs.ratio}×）` },
          { k: '类型', v: Object.entries(hs.byType).map(([k, v]) => `${TYPE_LABEL[k]} ${v}`).join(' · ') },
          { k: '在线', v: `${hs.curve.v0} → ${hs.curve.v1} 人（${hs.curve.delta}）` },
        ],
        template: '被反复标记的地方正好也是人走的地方 —— 这段要么讲得太快，要么没解决观众真正的问题。',
      });
      continue progress;
    }
    const dom = Object.entries(hs.share).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'key';
    const kindMap = { question: 'hotspot-question', fix: 'hotspot-fix', step: 'hotspot-step', key: 'hotspot-key', case: 'hotspot-case' };
    findings.push({
      id: `${hs.id}-${dom}`,
      kind: kindMap[dom] ?? 'hotspot-key',
      level: dom === 'question' || dom === 'fix' ? 'high' : 'medium',
      t0: hs.t0,
      t1: hs.t1,
      title: `${AREA_LABEL[dom]}最集中 · ${arc}`,
      evidence: [
        { k: '卡片', v: `${hs.cards} 张（${hs.perMin}/分钟，全场均值 ${perMin.toFixed(2)}/分钟，${hs.ratio}×）` },
        { k: '类型', v: Object.entries(hs.byType).map(([k, v]) => `${TYPE_LABEL[k]} ${v}`).join(' · ') },
        ...(hs.curve ? [{ k: '在线', v: `${hs.curve.v0} → ${hs.curve.v1} 人` }] : []),
      ],
      template: TEMPLATE[dom] ?? '',
    });
  }

  const fixCards = cards.filter((c) => c.type === 'fix');
  if (fixCards.length) {
    findings.push({
      id: 'fix-1',
      kind: 'fix',
      level: 'high',
      t0: fixCards[0].t,
      t1: fixCards[fixCards.length - 1].t,
      title: `${fixCards.length} 张卡片对讲解内容存疑，需要讲师确认`,
      evidence: [
        { k: '卡片', v: fixCards.map((c) => `${fmt(c.t)}「${c.quote.slice(0, 18)}…」`).join('；') },
        { k: '来源', v: `${new Set(fixCards.map((c) => c.viewer)).size} 位观众各自标记` },
      ],
      template: '观众标记「疑似讲错」不等于真的讲错，但值得逐条核对：真错就发勘误，没讲错说明表述有歧义，下一期要换个说法。',
      cards: fixCards.map((c) => ({ id: c.id, t: c.t, type: c.type, quote: c.quote, viewer: c.viewer, note: c.note ?? '' })),
    });
  }

  for (const sl of silences) {
    findings.push({
      id: `silence-${sl.chapterId}`,
      kind: 'silence',
      level: 'low',
      t0: sl.t0,
      t1: sl.t1,
      title: `${sl.minutes} 分钟的「${sl.chapter}」只有 ${sl.cards} 张卡片`,
      evidence: [
        { k: '卡片', v: `${sl.cards} 张 / ${sl.minutes} 分钟（全场均值 ${perMin.toFixed(2)}/分钟）` },
      ],
      template: '两种可能，需要讲师自己判断：这段讲得顺、观众没疑问；或者这段信息量低、和观众关心的问题无关。如果连续几场都这样，建议压缩或换成案例。',
    });
  }

  for (const g of gaps) {
    findings.push({
      id: `gap-${g.kind}`,
      kind: 'gap',
      level: 'low',
      t0: g.t0,
      t1: g.t1,
      title: `${g.minutes} 分钟没有内容章节（${g.kind === 'head' ? '开场' : '结尾'}）`,
      evidence: [{ k: '时长', v: `${fmt(g.t0)} – ${fmt(g.t1)}` }],
      template: g.note,
    });
  }

  // ---------- 合并离线模型解读（数字不动，只替换措辞）----------
  const ai = readJson(path.join(AI_DIR, `${sid}.json`), null);
  const merged = findings.map((f) => {
    const ov = ai?.findings?.[f.id];
    const d = { ...f };
    delete d.template;
    d.judgment = ov?.judgment ?? f.template ?? '';
    d.action = ov?.action ?? '';
    d.cards = f.cards ?? [];
    return d;
  });

  const levelRank = { high: 0, medium: 1, low: 2 };
  merged.sort((a, b) => levelRank[a.level] - levelRank[b.level] || a.t0 - b.t0);

  const byType = {};
  for (const c of cards) byType[c.type] = (byType[c.type] ?? 0) + 1;

  const viewerCount = cardsFile.viewers ?? new Set(cards.map((c) => c.viewer)).size;
  // 样本闸门：人少、卡少的场次，结论只能当参考
  const reliable = viewerCount >= 20 && cards.length >= 40;

  const report = {
    sessionId: sid,
    title: s?.title ?? meta.title ?? '',
    day: s?.day ?? null,
    startTime: s?.startTime ?? null,
    generatedAt: new Date().toISOString(),
    engine: {
      evidence: 'rule',
      narrative: ai ? 'offline-model' : 'template',
      prompt: ai?.meta?.prompt ?? null,
      model: ai?.meta?.model ?? null,
    },
    source: {
      cards: cardsFile.source ?? 'sim',
      curve: curve ? (curve.source ?? 'real') : 'none',
      chapters: 'ai-outline',
      disclaimer: cardsFile.disclaimer ?? '',
    },
    jumpUrl: s?.alignment?.watchUrl ?? s?.watchUrl ?? null,
    reliability: {
      level: reliable ? 'ok' : 'low',
      reason: reliable
        ? `${viewerCount} 位观众留下 ${cards.length} 张卡片，样本够做强判断`
        : `${viewerCount} 位观众、${cards.length} 张卡片，样本偏少：热点位置可信，但「该不该重讲」请讲师自己判断`,
    },
    curveGate: {
      show: curveShow,
      usable: curveUsable,
      peak: curvePeak || null,
      points: curve?.points.length ?? 0,
      reason: curveUsable
        ? '曲线样本足够，可与卡片密度做交叉判断'
        : curveShow
          ? `峰值只有 ${curvePeak} 人，人数变化在噪声范围内：曲线只作展示，不参与归因`
          : curve
            ? `曲线只有 ${curve.points.length} 个采样点，太稀，不参与判断`
            : '这场没有人数曲线',
    },
    scale: {
      durationSec: duration,
      durationMin: Number((duration / 60).toFixed(1)),
      viewers: viewerCount,
      cards: cards.length,
      perViewer: Number((cards.length / Math.max(1, viewerCount)).toFixed(2)),
      perMin: Number(perMin.toFixed(2)),
      byType,
      chapters: chapterRows.length,
      peak: curveUsable ? curvePeak : (s?.maxConcurrency ?? curvePeak ?? null),
    },
    bucketSec: BUCKET,
    windowMin: WIN * BUCKET / 60,
    grid: { types: ROWS, labels: TYPE_LABEL, rows: grid, totals, cellMax },
    chapters: chapterRows,
    covered: { t0: covered0, t1: covered1 },
    hotspots,
    gaps,
    silences,
    findings: merged,
    verdict: ai?.verdict ?? null,
    plan: ai?.plan ?? null,
  };

  writeJson(path.join(CONTRACT, 'teacher', `${sid}.json`), report);
  index.push({
    sessionId: sid,
    title: report.title,
    day: report.day,
    cards: cards.length,
    viewers: report.scale.viewers,
    hotspots: hotspots.length,
    findings: merged.length,
    high: merged.filter((f) => f.level === 'high').length,
    minutes: report.scale.durationMin,
    hasCurve: !!curve,
    ai: !!ai,
  });
  log.push(`${sid} cards=${cards.length} buckets=${nb} hotspots=${hotspots.length} findings=${merged.length} ai=${!!ai}`);
}

writeJson(path.join(CONTRACT, 'teacher', 'index.json'), {
  meta: { generatedAt: new Date().toISOString(), engine: 'rule+offline-model', sessions: index.length },
  sessions: index,
});

console.log('[teacher] ' + log.length + ' sessions');
for (const l of log) console.log('[teacher] ' + l);

function fmt(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}'${String(s % 60).padStart(2, '0')}"`;
}
