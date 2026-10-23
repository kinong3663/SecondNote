/**
 * 归因引擎（前端版）—— 与 scripts/review.mjs 同一套规则，保证前后端结论一致。
 * 原则：判断靠规则 + 数据，大模型只负责措辞；每条结论必须带证据。
 */
import type {
  Completeness, Curve, CurvePoint, DropPoint, InteractionEvent, Interactions,
  Session, Tier, TopicSegment, Topics,
} from './types';

const mmss = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}'${String(s % 60).padStart(2, '0')}"`;
};

export const fmtTime = mmss;

export const fmtPct = (v: number): string => `${(v * 100).toFixed(1)}%`;

export function peakOf(points: CurvePoint[]): number {
  return points.reduce((m, p) => Math.max(m, p.v), 0);
}

export function avgOf(points: CurvePoint[]): number {
  if (!points.length) return 0;
  return points.reduce((s, p) => s + p.v, 0) / points.length;
}

/** 在话题线里找某个时刻所属段落 */
export function topicAt(topics: Topics | null, t: number): TopicSegment | null {
  if (!topics) return null;
  return topics.segments.find((s) => t >= s.startSec && t < s.endSec) ?? null;
}

/** 时间窗内的互动事件 */
export function eventsIn(inter: Interactions | null, a: number, b: number): InteractionEvent[] {
  if (!inter) return [];
  return inter.events.filter((e) => e.t >= a && e.t <= b);
}

export interface DetectOptions {
  windowSec?: number;
  /** 峰值低于该值不出掉人点结论（样本量闸门） */
  minPeak?: number;
  /** 相对中位的异常阈值 */
  threshold?: number;
  top?: number;
}

export interface DetectResult {
  drops: DropPoint[];        // 已带归因
  gated: boolean;            // 是否被样本量闸门拦下
  reason?: string;
  medianDrop: number;
  sampleCount: number;
}

/**
 * 掉人点检测：3 分钟滑窗 + 去趋势（用全场窗口中位跌幅做基准）。
 * 两道闸门：峰值 < minPeak 不出结论；不足 4 个点不出结论。
 */
export function detectDrops(
  curve: Curve | null,
  topics: Topics | null,
  inter: Interactions | null,
  opts: DetectOptions = {},
): DetectResult {
  const windowSec = opts.windowSec ?? 180;
  const minPeak = opts.minPeak ?? 20;
  const threshold = opts.threshold ?? -0.15;
  const top = opts.top ?? 3;

  if (!curve || curve.points.length < 4) {
    return { drops: [], gated: true, reason: '无曲线数据', medianDrop: 0, sampleCount: 0 };
  }
  const pts = [...curve.points].sort((a, b) => a.t - b.t);
  const peak = peakOf(pts);
  if (peak < minPeak) {
    return {
      drops: [],
      gated: true,
      reason: `峰值 ${peak} 人，低于 ${minPeak} 人的分析阈值，不做掉人点归因`,
      medianDrop: 0,
      sampleCount: pts.length,
    };
  }

  // 按 windowSec 采样滑窗
  const step = curve.bucketSec || 60;
  const w = Math.max(2, Math.round(windowSec / step));
  const wins: { i: number; drop: number; from: number; to: number }[] = [];
  for (let i = 0; i + w < pts.length; i++) {
    const from = pts[i].v;
    const to = pts[i + w].v;
    if (from < 2) continue;
    wins.push({ i, drop: (to - from) / from, from, to });
  }
  if (!wins.length) return { drops: [], gated: true, reason: '有效窗口不足', medianDrop: 0, sampleCount: pts.length };

  const sorted = [...wins].map((x) => x.drop).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  const cands = wins
    .map((x) => ({ ...x, abnormal: x.drop - median }))
    .filter((x) => x.abnormal <= threshold)
    .sort((a, b) => a.abnormal - b.abnormal);

  const picked: typeof cands = [];
  for (const c of cands) {
    if (picked.some((p) => Math.abs(pts[p.i].t - pts[c.i].t) < windowSec)) continue;
    picked.push(c);
    if (picked.length >= top) break;
  }

  const drops: DropPoint[] = picked.map((c) => {
    const tStart = pts[c.i].t;
    const tEnd = pts[c.i + w].t;
    const seg = topicAt(topics, tStart);
    const evs = eventsIn(inter, tStart, tEnd);
    const isLast = tEnd >= (pts.at(-1)?.t ?? 0) - 300;
    const nearSwitch = seg ? Math.abs(tStart - seg.startSec) <= 60 : false;

    let cause: string;
    let rule: string;
    let fix: string;
    let confidence: DropPoint['confidence'] = 'high';

    // 判断顺序：越具体的归因越优先（收尾 > 切换 > 无互动 > 兜底）
    if (isLast) {
      cause = '收尾没给下一步（临近结束流失）';
      rule = '掉人窗口落在最后 5 分钟';
      fix = '结尾前 3 分钟预告下一场 + 给资料/回放入口，把"结束"变成"下一步"；若确为散场流失，下次把核心结论提前到结束前。';
      confidence = 'medium';
    } else if (nearSwitch) {
      cause = '过渡生硬（话题切换处掉人）';
      rule = '掉人窗口起点距话题切换 ≤ 60 秒';
      fix = `切换进入「${seg?.topic ?? ''}」时没有预告，加一句转场：「接下来这段讲 ${seg?.topic ?? ''}，只关心结论的听完这句就行。」`;
      confidence = 'medium';
    } else if (evs.length === 0) {
      cause = '单口讲解过长（窗口内无任何互动）';
      rule = `窗口内互动事件 = 0，且 3 分钟跌幅 ${fmtPct(c.drop)}`;
      fix = `在此段之前插一句提问，并把这一段压到 3 分钟内；可直接用：「${seg?.topic ?? '这一段'}，你们现在团队里是怎么做的？打在公屏上。」`;
    } else {
      cause = '内容与预期不符';
      rule = '窗口内有互动但仍掉人';
      fix = '掉人点前补一句「这段解决什么问题」，并在开场 2 分钟讲清本场地图。';
      confidence = 'low';
    }

    return {
      tStart, tEnd, from: c.from, to: c.to,
      drop: Number(c.drop.toFixed(4)),
      abnormal: Number(c.abnormal.toFixed(4)),
      topic: seg?.topic ?? null,
      cause, rule, fix, confidence,
    };
  });

  return { drops, gated: false, medianDrop: Number(median.toFixed(4)), sampleCount: pts.length };
}

/** 内容体检的风险段：段长 ≥ 8 分钟且没有互动钩子 */
const HOOK_RE = /[？?]|扣\s*个?\s*1|打在公屏|公屏上|试一下|注意看|看这里|有没有|大家看|举手|签到|投票/;

export interface SegmentRisk {
  segment: TopicSegment;
  hooks: number;
  level: 'high' | 'medium' | 'low';
}

export function segmentRisks(topics: Topics | null): SegmentRisk[] {
  if (!topics) return [];
  return topics.segments.map((seg) => {
    const hooks = (seg.text.match(HOOK_RE) ?? []).length;
    const level: SegmentRisk['level'] =
      seg.minutes >= 8 && hooks === 0 ? 'high' : seg.minutes >= 6 && hooks <= 1 ? 'medium' : 'low';
    return { segment: seg, hooks, level };
  });
}

/** 数据完整度判定 */
export function completeness(
  session: Session,
  curve: Curve | null,
  topics: Topics | null,
  inter: Interactions | null,
): Completeness {
  const has: string[] = [];
  const missing: string[] = [];
  const notes: string[] = [];

  has.push('场次与统计');
  if (curve) has.push('人数曲线'); else missing.push('人数曲线');
  if (topics) has.push('讲师话题'); else missing.push('讲师话题');
  if (inter && inter.events.length) has.push(`互动事件 ${inter.events.length} 条`);
  else missing.push('互动事件');

  const tier: Tier = missing.length === 0 ? 'A' : missing.length === 1 ? 'B' : 'C';

  if (inter && !inter.events.length && inter.note) notes.push(inter.note);
  if (curve) {
    const peak = peakOf(curve.points);
    notes.push(`曲线峰值 ${peak} 人 · ${curve.points.length} 个采样点 · 来源 ${curve.origin ?? curve.kind}`);
  }
  if (topics) notes.push(`话题 ${topics.segments.length} 段 · ${topics.cues} 条字幕 · 来源 ${topics.origin ?? topics.source}`);
  if (session.videoId) notes.push(`回放 videoId ${session.videoId}`);

  return { tier, has, missing, notes };
}

export const tierLabel = (t: Tier): string =>
  t === 'A' ? 'A · 三线齐备' : t === 'B' ? 'B · 缺一条线' : 'C · 仅场次级';
