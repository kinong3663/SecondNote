/**
 * 教师端聚合引擎（服务端）—— 把观众卡片变成讲师能直接用的复盘
 *
 * 规则和 /src/build-teacher.mjs 那套完全一致，只是输入从静态 JSON 换成了真实上报的卡片：
 *   · 2 分钟一格 × 5 类卡片 = 热力网格
 *   · 6 分钟滑窗 → 40% 阈值 → 连续段合并 → 收到 ≤12 分钟的"热点区段"
 *   · 章节取「包含该秒的最深章节」（官方大纲可能是父章包住子章）
 *   · 两个闸门：卡片太少不出强结论；没有人数曲线就不谈"掉人"
 *
 * 这里只产**数字和模板措辞**，AI 解读由前端按 sessionId 去 data/teacher/ai/*.json 覆盖。
 */

const BUCKET = 120; // 2 分钟一格
const WIN = 3; // 6 分钟滑窗
const TYPES = ['question', 'fix', 'step', 'key', 'case'];
const LABELS = { question: '疑问', fix: '存疑', step: '操作步骤', key: '重点', case: '案例' };
const WEIGHT = { question: 1.6, fix: 2.4, key: 1.0, step: 0.7, case: 0.5 };
const AREA = { question: '疑问', fix: '存疑', step: '操作步骤', key: '重点', case: '案例' };
const TEMPLATE = {
  question: '追问最密集的一段 —— 观众不是没听，是这里需要更细的拆解。',
  fix: '存疑卡片集中在这段，需要讲师逐条核对。',
  step: '大家想照着做，说明这段是操作演示 —— 缺的是可执行的清单，不是再听一遍。',
  key: '被当作重点反复标记，这段可以直接沉淀成课后复习题。',
  case: '案例被反复标记，说明观众想把它搬回自己的场景。',
};

const fmt = (sec) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}'${String(s % 60).padStart(2, '0')}"`;
};

/** 包含 t 的、最内层那一章（父章节 start 更早、跨度更大） */
function deepestAt(chapters, t) {
  let best = null;
  for (const c of chapters) {
    if (t < c.start || t >= c.end) continue;
    if (!best) best = c;
    else if (c.start > best.start) best = c;
    else if (c.start === best.start && c.end - c.start < best.end - best.start) best = c;
  }
  return best;
}

/** 把时间轴切成"每段归属同一章"的连续区间 */
function partitionByDeepest(chapters, durationSec) {
  const marks = new Set([0, durationSec]);
  for (const c of chapters) {
    for (const t of [c.start, c.end]) {
      if (t > 0 && t < durationSec) marks.add(Number(t.toFixed(3)));
    }
  }
  const points = [...marks].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    if (end - start < 0.5) continue;
    const owner = deepestAt(chapters, (start + end) / 2);
    const key = owner ? owner.title : null;
    const last = parts[parts.length - 1];
    if (last && last.key === key && Math.abs(last.start + last.end - (start + end)) < 4) {
      last.end = end;
    } else if (last && last.key === key) {
      last.end = end;
    } else {
      parts.push({ key, title: owner?.title ?? null, start, end, summary: owner?.summary ?? [] });
    }
  }
  return parts;
}

export function aggregate({ notes, chapters = [], durationSec, title = '', videoKey = '', sessionId = null, jumpUrl = null }) {
  const cards = [...notes].sort((a, b) => a.time - b.time);
  const duration = Math.max(durationSec || 0, cards.at(-1)?.time + BUCKET || 0, 600);
  const nb = Math.max(1, Math.ceil(duration / BUCKET));

  // ---------- 网格 ----------
  const rows = TYPES.map((type) => ({ type, counts: new Array(nb).fill(0) }));
  const totals = new Array(nb).fill(0);
  const weightAt = new Array(nb).fill(0);
  for (const card of cards) {
    const b = Math.min(nb - 1, Math.max(0, Math.floor(card.time / BUCKET)));
    const row = rows.find((r) => r.type === card.type);
    if (row) row.counts[b] += 1;
    totals[b] += 1;
    weightAt[b] += WEIGHT[card.type] ?? 1;
  }
  const cellMax = Math.max(1, ...rows.flatMap((r) => r.counts));

  // ---------- 章节 ----------
  const parts = chapters.length ? partitionByDeepest(chapters, duration) : [];
  const chapterRows = parts.map((part, index) => {
    const list = cards.filter((c) => c.time >= part.start && c.time < part.end);
    const byType = {};
    for (const c of list) byType[c.type] = (byType[c.type] ?? 0) + 1;
    const minutes = (part.end - part.start) / 60;
    return {
      id: part.title ? `${part.title}-${index}` : `gap-${index}`,
      topic: part.title ?? '（无章节）',
      t0: part.start,
      t1: part.end,
      minutes: Number(minutes.toFixed(1)),
      cards: list.length,
      byType,
      perMin: Number((list.length / Math.max(0.1, minutes)).toFixed(2)),
      summary: part.summary,
    };
  });

  const coveredParts = chapterRows.filter((c) => c.topic !== '（无章节）');
  const covered0 = coveredParts.length ? coveredParts[0].t0 : 0;
  const covered1 = coveredParts.length ? coveredParts[coveredParts.length - 1].t1 : duration;
  const spanMin = Math.max(1, (covered1 - covered0) / 60);
  const perMin = cards.length / spanMin;

  // ---------- 热点 ----------
  const S = new Array(nb).fill(0);
  for (let i = 0; i + WIN <= nb; i++) {
    let s = 0;
    for (let k = i; k < i + WIN; k++) s += weightAt[k];
    S[i] = s;
  }
  const maxS = Math.max(...S, 0);
  const threshold = maxS * 0.4;
  const runs = [];
  let cur = null;
  for (let i = 0; i < nb; i++) {
    const hot = S[i] > 0 && S[i] >= threshold;
    if (hot) {
      if (cur) cur.i1 = i;
      else cur = { i0: i, i1: i };
    } else if (cur) {
      runs.push(cur);
      cur = null;
    }
  }
  if (cur) runs.push(cur);

  const hotspots = runs
    .map((run) => {
      // 统一用 6 分钟窗口：在热点区段里滑一遍，取卡片最密的那 6 分钟
      const spanStart = run.i0;
      const spanEnd = Math.min(nb - 1, run.i1 + WIN - 1);
      let bestStart = spanStart;
      let bestScore = -1;
      for (let start = spanStart; start + WIN - 1 <= spanEnd; start += 1) {
        let sum = 0;
        for (let k = start; k < start + WIN; k += 1) sum += weightAt[k];
        if (sum > bestScore) {
          bestScore = sum;
          bestStart = start;
        }
      }
      const i0 = bestStart;
      const i1 = Math.min(nb - 1, bestStart + WIN - 1);
      const counts = { question: 0, fix: 0, step: 0, key: 0, case: 0 };
      let n = 0;
      let score = 0;
      for (let k = i0; k <= i1; k++) {
        n += totals[k];
        score += weightAt[k];
        for (const row of rows) counts[row.type] += row.counts[k];
      }
      const t0 = i0 * BUCKET;
      const t1 = Math.min(duration, (i1 + 1) * BUCKET);
      return { t0, t1, n, counts, score };
    })
    .filter((h) => h.n > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((h, index) => {
      const minutes = (h.t1 - h.t0) / 60;
      const share = {};
      for (const [k, v] of Object.entries(h.counts)) if (v) share[k] = Number((v / h.n).toFixed(3));
      const owner =
        deepestAt(chapters, (h.t0 + h.t1) / 2) ?? deepestAt(chapters, h.t0) ?? null;
      const samples = [];
      const seen = new Set();
      for (const c of cards
        .filter((c) => c.time >= h.t0 && c.time < h.t1)
        .sort((a, b) => (WEIGHT[b.type] ?? 1) - (WEIGHT[a.type] ?? 1))) {
        const fp = String(c.subtitle || c.summary || '').slice(0, 12);
        if (seen.has(fp)) continue;
        seen.add(fp);
        samples.push({
          id: c.id,
          t: c.time,
          type: c.type,
          // quote 是观众自己写的那句话（教师最想看的就是它），note 留原字幕做锚点
          quote: String(c.summary || c.subtitle || ''),
          viewer: c.visitorId || 'anon',
          note: String(c.subtitle || ''),
        });
        if (samples.length >= 5) break;
      }
      return {
        id: `hs${index + 1}`,
        rank: index + 1,
        t0: h.t0,
        t1: h.t1,
        chapterId: owner ? owner.title : null,
        chapter: owner ? owner.title : null,
        cards: h.n,
        byType: h.counts,
        share,
        score: Number(h.score.toFixed(2)),
        perMin: Number((h.n / minutes).toFixed(2)),
        ratio: Number((h.n / minutes / Math.max(0.01, perMin)).toFixed(2)),
        curve: null,
        samples,
      };
    });

  // ---------- 缺口 / 沉默段 ----------
  const gaps = chapterRows
    .filter((c) => c.topic === '（无章节）' && c.minutes >= 5)
    .map((c) => ({ kind: c.t0 === 0 ? 'head' : 'mid', t0: c.t0, t1: c.t1, minutes: Math.round(c.minutes), note: '这一段官方 AI 大纲没有章节，卡片无法归章' }));

  const silences =
    cards.length === 0
      ? []
      : chapterRows
          .filter(
            (c) =>
              c.topic !== '（无章节）' &&
              c.minutes >= 10 &&
              c.perMin < Math.max(0.15, perMin * 0.4),
          )
          .map((c) => ({ chapterId: c.id, chapter: c.topic, t0: c.t0, t1: c.t1, minutes: c.minutes, cards: c.cards }));

  // ---------- findings ----------
  const findings = [];
  for (const hs of hotspots) {
    const dom = Object.entries(hs.share).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'key';
    const kindMap = { question: 'hotspot-question', fix: 'hotspot-fix', step: 'hotspot-step', key: 'hotspot-key', case: 'hotspot-case' };
    findings.push({
      id: `${hs.id}-${dom}`,
      kind: kindMap[dom] ?? 'hotspot-key',
      level: dom === 'question' || dom === 'fix' ? 'high' : 'medium',
      t0: hs.t0,
      t1: hs.t1,
      title: hs.chapter ? `${AREA[dom]}最集中 · ${hs.chapter}` : `${AREA[dom]}最集中`,
      evidence: [
        { k: '卡片', v: `${hs.cards} 张（${hs.perMin}/分钟，全场均值 ${perMin.toFixed(2)}/分钟，${hs.ratio}×）` },
        { k: '类型', v: Object.entries(hs.byType).map(([k, v]) => `${LABELS[k]} ${v}`).join(' · ') },
      ],
      judgment: TEMPLATE[dom] ?? '',
      action: '',
      cards: hs.samples,
    });
  }

  const fixCards = cards.filter((c) => c.type === 'fix');
  if (fixCards.length) {
    const first = fixCards[0].time;
    const last = fixCards[fixCards.length - 1].time;
    findings.push({
      id: 'fix-1',
      kind: 'fix',
      level: 'high',
      // 单张卡时 t0 === t1，区间退化成一条线，前后各撑 30 秒便于在热力图上定位
      t0: Math.max(0, first - 30),
      t1: Math.min(duration, last + 30),
      title: `${fixCards.length} 张卡片对讲解内容存疑，需要讲师确认`,
      evidence: [
        { k: '卡片', v: fixCards.map((c) => `${fmt(c.time)}「${String(c.summary || c.subtitle || '').slice(0, 18)}…」`).join('；') },
        { k: '来源', v: `${new Set(fixCards.map((c) => c.visitorId)).size} 位观众各自标记` },
      ],
      judgment: '观众标「疑似讲错」不等于真的讲错，但值得逐条核对：真错就发勘误，没讲错说明表述有歧义，下一期换个说法。',
      action: '',
      cards: fixCards.map((c) => ({ id: c.id, t: c.time, type: c.type, quote: c.summary || c.subtitle || '', viewer: c.visitorId || 'anon', note: '' })),
    });
  }

  for (const s of silences) {
    findings.push({
      id: `silence-${s.chapterId}`,
      kind: 'silence',
      level: 'low',
      t0: s.t0,
      t1: s.t1,
      title: `${s.minutes} 分钟的「${s.chapter}」只有 ${s.cards} 张卡片`,
      evidence: [{ k: '卡片', v: `${s.cards} 张 / ${s.minutes} 分钟（全场均值 ${perMin.toFixed(2)}/分钟）` }],
      judgment: '两种可能，需要讲师自己判断：这段讲得顺、观众没疑问；或者这段信息量低。如果连续几场都这样，建议压缩或换成案例。',
      action: '',
      cards: [],
    });
  }

  for (const g of gaps) {
    findings.push({
      id: `gap-${g.kind}-${Math.round(g.t0)}`,
      kind: 'gap',
      level: 'low',
      t0: g.t0,
      t1: g.t1,
      title: `${g.minutes} 分钟没有内容章节`,
      evidence: [{ k: '时长', v: `${fmt(g.t0)} – ${fmt(g.t1)}` }],
      judgment: g.note,
      action: '',
      cards: [],
    });
  }

  const levelRank = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => levelRank[a.level] - levelRank[b.level] || a.t0 - b.t0);

  const byType = {};
  for (const c of cards) byType[c.type] = (byType[c.type] ?? 0) + 1;
  const viewers = new Set(cards.map((c) => c.visitorId).filter(Boolean)).size;
  const enough = cards.length >= 12;

  const dom = Object.entries(byType).sort((a, b) => b[1] - a[1])[0];
  const top = hotspots[0];
  const topWhere = top
    ? top.chapter
      ? `${fmt(top.t0)}–${fmt(top.t1)}「${top.chapter}」`
      : `${fmt(top.t0)}–${fmt(top.t1)}`
    : '';
  const verdict = cards.length
    ? `这一场已经收到 ${cards.length} 张秒记卡（${viewers} 位观众），密度 ${perMin.toFixed(2)} 张/分钟。${
        top ? `最集中的一段是 ${topWhere}，${top.ratio}× 于全场均值。` : ''
      }${dom ? `卡片以「${LABELS[dom[0]]}」为主（${dom[1]} 张）。` : ''}`
    : '还没有观众留下秒记卡 —— 让观众在播放页点几下「记一下」，这里会实时长出来。';

  return {
    sessionId: sessionId ?? videoKey,
    videoKey,
    title: title || videoKey,
    generatedAt: new Date().toISOString(),
    engine: { evidence: 'rule', narrative: 'template', prompt: null, model: null },
    reliability: {
      level: enough ? 'ok' : 'low',
      reason:
        cards.length === 0
          ? '还没有卡片。让观众在播放页点几下「记一下」，这里会随点随长（教师页每 8 秒刷新一次）'
          : enough
            ? `${viewers} 位观众留下 ${cards.length} 张卡片，样本够做强判断`
            : `目前只有 ${cards.length} 张卡片，样本偏少：热点位置可信，结论请讲师自己复核（满 12 张后自动切换为强结论）`,
    },
    curveGate: { show: false, usable: false, peak: null, points: 0, reason: '现场卡片没有人数曲线，不做人数交叉判断' },
    source: { cards: 'real', curve: 'none', chapters: chapters.length ? 'ai-outline' : 'none', disclaimer: '卡片来自观众端实时上报（work/notes）' },
    jumpUrl,
    scale: {
      durationSec: duration,
      durationMin: Number((duration / 60).toFixed(1)),
      viewers,
      cards: cards.length,
      perViewer: Number((cards.length / Math.max(1, viewers)).toFixed(2)),
      perMin: Number(perMin.toFixed(2)),
      byType,
      chapters: new Set(
        chapterRows.filter((c) => c.topic !== '（无章节）').map((c) => c.topic),
      ).size,
      peak: null,
    },
    bucketSec: BUCKET,
    windowMin: (WIN * BUCKET) / 60,
    grid: { types: TYPES, labels: LABELS, rows, totals, cellMax },
    chapters: chapterRows,
    covered: { t0: covered0, t1: covered1 },
    hotspots,
    gaps,
    silences,
    findings,
    verdict,
    plan: null,
    live: { count: cards.length, updatedAt: new Date().toISOString() },
  };
}
