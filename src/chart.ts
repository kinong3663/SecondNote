/** 三线时间轴渲染（纯 SVG 字符串，无第三方图表库） */
import { fmtPct, fmtTime, peakOf } from './analysis';
import type { Curve, DropPoint, InteractionEvent, TopicSegment, Topics } from './types';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const n = (v: number): string => (Math.round(v * 10) / 10).toString();

export interface TimelineInput {
  curve: Curve;
  topics: Topics | null;
  events: InteractionEvent[];
  drops: DropPoint[];
  height?: number;
}

/** 三线共用一根 x 轴：人数曲线 + 话题分段色带 + 互动事件标记 + 掉人点 */
export function renderTimeline(input: TimelineInput): string {
  const { curve, topics, events, drops } = input;
  const W = 1000;
  const H = input.height ?? 300;
  const pad = { l: 46, r: 18, t: 18, b: 54 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;

  const pts = [...curve.points].sort((a, b) => a.t - b.t);
  const tMax = Math.max(
    pts.at(-1)?.t ?? 60,
    topics?.segments.at(-1)?.endSec ?? 0,
    ...events.map((e) => e.t),
    60,
  );
  const yMax = Math.max(4, peakOf(pts) * 1.18);

  const x = (t: number): number => pad.l + (t / tMax) * plotW;
  const y = (v: number): number => pad.t + plotH - (v / yMax) * plotH;

  // 面积 + 折线
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${n(x(p.t))},${n(y(p.v))}`).join(' ');
  const area = `${line} L${n(x(pts.at(-1)?.t ?? 0))},${n(pad.t + plotH)} L${n(x(pts[0]?.t ?? 0))},${n(pad.t + plotH)} Z`;

  // y 轴刻度
  const ticks = 4;
  let grid = '';
  for (let i = 0; i <= ticks; i++) {
    const v = (yMax / ticks) * i;
    const yy = y(v);
    grid += `<line x1="${pad.l}" y1="${n(yy)}" x2="${W - pad.r}" y2="${n(yy)}" class="grid"/>`;
    grid += `<text x="${pad.l - 8}" y="${n(yy + 4)}" class="axis" text-anchor="end">${Math.round(v)}</text>`;
  }

  // x 轴刻度（每 10 分钟）
  let xTicks = '';
  const stepT = tMax > 3600 ? 600 : tMax > 900 ? 300 : 60;
  for (let t = 0; t <= tMax; t += stepT) {
    xTicks += `<text x="${n(x(t))}" y="${H - 34}" class="axis" text-anchor="middle">${fmtTime(t)}</text>`;
  }

  // 话题色带
  let band = '';
  const bandY = pad.t + plotH + 8;
  if (topics) {
    const colors = ['#3b3f52', '#454a61', '#3f4459', '#4a4f68'];
    topics.segments.forEach((seg, i) => {
      const w = Math.max(1, x(seg.endSec) - x(seg.startSec));
      band += `<rect x="${n(x(seg.startSec))}" y="${bandY}" width="${n(w)}" height="14" fill="${colors[i % colors.length]}" class="seg" data-seg="${seg.id}"><title>${esc(seg.topic)} · ${seg.minutes.toFixed(1)}min</title></rect>`;
    });
    band += `<text x="${pad.l}" y="${bandY + 27}" class="axis">话题线（${topics.segments.length} 段）</text>`;
  }

  // 掉人点：红色竖带 + 顶点标注
  let dropMarks = '';
  drops.forEach((d, i) => {
    const x1 = x(d.tStart);
    const x2 = x(d.tEnd);
    dropMarks += `<rect x="${n(x1)}" y="${pad.t}" width="${n(Math.max(2, x2 - x1))}" height="${plotH}" class="dropband"/>`;
    dropMarks += `<line x1="${n(x1)}" y1="${n(y(d.from))}" x2="${n(x2)}" y2="${n(y(d.to))}" class="dropline"/>`;
    dropMarks += `<circle cx="${n(x1)}" cy="${n(y(d.from))}" r="4" class="dotDrop"/>`;
    dropMarks += `<text x="${n(x1 + 4)}" y="${n(y(d.from) - 8)}" class="droplabel">#${i + 1} ${fmtPct(d.drop)}</text>`;
  });

  // 互动事件：线上圆点
  let evMarks = '';
  for (const e of events) {
    const near = pts.reduce((best, p) => (Math.abs(p.t - e.t) < Math.abs(best.t - e.t) ? p : best), pts[0]);
    evMarks += `<circle cx="${n(x(e.t))}" cy="${n(y(near.v))}" r="5" class="evdot"><title>${esc(e.type)}${e.joined != null ? ' · ' + e.joined + ' 人参与' : ''}</title></circle>`;
  }

  return `<svg viewBox="0 0 ${W} ${H}" class="timeline" role="img" aria-label="三线时间轴">
    <defs>
      <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#c9a227" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#c9a227" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    ${grid}
    <path d="${area}" fill="url(#areaFill)"/>
    <path d="${line}" class="online"/>
    ${dropMarks}
    ${evMarks}
    ${band}
    ${xTicks}
    <text x="${pad.l}" y="${pad.t - 4}" class="axis">在线人数（峰值 ${peakOf(pts)} 人 · ${curve.points.length} 点 · ${curve.kind}）</text>
  </svg>`;
}

/** 内容模式：话题分段条形 + 风险标签（无曲线时使用） */
export function renderTopicBars(topics: Topics, risks: { segment: TopicSegment; hooks: number; level: string }[]): string {
  const total = topics.durationSec || topics.segments.at(-1)?.endSec || 1;
  const W = 1000;
  const rowH = 30;
  const H = topics.segments.length * rowH + 16;
  const labelW = 250;
  const barW = W - labelW - 90;

  let rows = '';
  risks.forEach((r, i) => {
    const s = r.segment;
    const yy = i * rowH + 8;
    const w = Math.max(3, (s.minutes * 60 / total) * barW);
    const cls = r.level === 'high' ? 'barHigh' : r.level === 'medium' ? 'barMid' : 'barLow';
    rows += `<text x="0" y="${yy + 13}" class="rowlabel">${esc(fmtTime(s.startSec))} · ${esc(s.topic.slice(0, 22))}</text>`;
    rows += `<rect x="${labelW}" y="${yy + 2}" width="${n(w)}" height="14" rx="3" class="${cls}"><title>${esc(s.topic)} · ${s.minutes.toFixed(1)}min · 钩子 ${r.hooks}</title></rect>`;
    rows += `<text x="${labelW + n(w) + 6}" y="${yy + 13}" class="axis">${s.minutes.toFixed(1)}min · 钩子 ${r.hooks}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="topicbars" role="img" aria-label="话题分段">${rows}</svg>`;
}

/** 迷你曲线（场次列表用） */
export function renderSpark(points: { t: number; v: number }[], color = '#c9a227'): string {
  if (points.length < 2) return '';
  const W = 120;
  const H = 28;
  const tMax = points.at(-1)?.t || 1;
  const vMax = Math.max(1, ...points.map((p) => p.v));
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${n((p.t / tMax) * W)},${n(H - (p.v / vMax) * (H - 2) - 1)}`)
    .join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" class="spark"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
}
