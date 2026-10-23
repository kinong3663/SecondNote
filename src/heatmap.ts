/**
 * 教师端热力图 —— 类型 × 时间 × 卡片数，叠人数曲线与官方章节
 *
 * 为什么是二维热力图而不是一条密度曲线：
 * 一个时间点"有几张卡"只说明热，说明不了"为什么热"。
 * 疑问扎堆 = 没听懂；步骤扎堆 = 想照着做；疑似讲错扎堆 = 要勘误。
 * 把类型拆成行，讲师一眼就能看出该补什么。
 */
import { fmtTime } from './analysis';
import type { CardType, Curve, TeacherReport } from './types';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const n = (v: number): string => (Math.round(v * 10) / 10).toString();

export const TYPE_COLOR: Record<CardType, string> = {
  question: '#d9534f',
  fix: '#b46bd9',
  step: '#4a9bd9',
  key: '#c9a227',
  case: '#4fb286',
};

export const TYPE_LABEL: Record<CardType, string> = {
  question: '疑问',
  fix: '存疑',
  step: '操作步骤',
  key: '重点',
  case: '案例',
};

export interface HeatmapOpts {
  curve?: Curve | null;
  selected?: { t0: number; t1: number } | null;
}

export function renderHeatmap(r: TeacherReport, opts: HeatmapOpts = {}): string {
  const W = 1000;
  const padL = 104;
  const padR = 18;
  const plotW = W - padL - padR;

  const nb = r.grid.totals.length;
  const B = r.bucketSec;
  const tEnd = Math.max(r.scale.durationSec, nb * B);
  const x = (t: number): number => padL + (Math.min(t, tEnd) / tEnd) * plotW;

  const showCurve = !!opts.curve && opts.curve.points.length >= 2;
  const curveH = showCurve ? 84 : 0;
  const gapAbove = showCurve ? 10 : 0;
  const hotRowY = curveH + gapAbove;
  const hotRowH = 14;
  const bandY = hotRowY + hotRowH + 4;
  const bandH = 16;
  const gridY = bandY + bandH + 6;
  const rowH = 20;
  const rows = r.grid.rows;
  const gridH = (rows.length + 1) * rowH;
  const axisY = gridY + gridH + 30;
  const H = axisY + 8;

  let out = '';

  // ---------- 人数曲线 ----------
  if (showCurve && opts.curve) {
    const pts = [...opts.curve.points].sort((a, b) => a.t - b.t);
    const vMax = Math.max(4, ...pts.map((p) => p.v)) * 1.25;
    const y = (v: number): number => curveH - (v / vMax) * (curveH - 12) - 4;
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${n(x(p.t))},${n(y(p.v))}`).join(' ');
    const area = `${line} L${n(x(pts.at(-1)?.t ?? 0))},${curveH} L${n(x(pts[0]?.t ?? 0))},${curveH} Z`;
    out += `<path d="${area}" fill="url(#tgrad)"/>`;
    out += `<path d="${line}" fill="none" stroke="#8b91a3" stroke-width="1.2" opacity=".85"/>`;
    out += `<text x="${padL - 8}" y="12" class="axis" text-anchor="end">${Math.round(vMax / 1.25)} 人</text>`;
    out += `<text x="${padL}" y="12" class="axis">在线人数（真实曲线 · 峰值 ${Math.round(Math.max(...pts.map((p) => p.v)))} 人${r.curveGate.usable ? '' : ' · 仅展示'}）</text>`;
    // 峰值线
    for (const h of r.hotspots) {
      const px = x((h.t0 + h.t1) / 2);
      out += `<line x1="${n(px)}" y1="0" x2="${n(px)}" y2="${curveH}" class="hsline"/>`;
    }
  }

  // ---------- 热点条 ----------
  out += `<text x="10" y="${hotRowY + 11}" class="axis">热点</text>`;
  for (const h of r.hotspots) {
    const x1 = x(h.t0);
    const w = Math.max(6, x(h.t1) - x1);
    out += `<rect x="${n(x1)}" y="${hotRowY}" width="${n(w)}" height="${hotRowH}" rx="3" class="hsbar"><title>#${h.rank} ${fmtTime(h.t0)}–${fmtTime(h.t1)} · ${h.cards} 张</title></rect>`;
    out += `<text x="${n(x1 + 4)}" y="${hotRowY + 11}" class="hsnum">#${h.rank}</text>`;
  }

  // ---------- 官方章节带 ----------
  r.chapters.forEach((c, i) => {
    const x1 = x(c.t0);
    const w = Math.max(1, x(c.t1) - x1);
    const shade = i % 2 === 0 ? '#232838' : '#1c2130';
    out += `<rect x="${n(x1)}" y="${bandY}" width="${n(w)}" height="${bandH}" fill="${shade}"><title>${esc(c.topic)} · ${c.minutes}min · ${c.cards} 张</title></rect>`;
    if (w > 64) {
      out += `<text x="${n(x1 + 5)}" y="${bandY + 11}" class="bandlabel">${esc(c.topic.slice(0, Math.floor(w / 12)))}</text>`;
    }
  });

  // ---------- 内容线缺口 ----------
  for (const g of r.gaps) {
    out += `<rect x="${n(x(g.t0))}" y="${bandY}" width="${n(Math.max(2, x(g.t1) - x(g.t0)))}" height="${bandH}" class="gaphole"/>`;
    if (x(g.t1) - x(g.t0) > 130) {
      out += `<text x="${n((x(g.t0) + x(g.t1)) / 2)}" y="${bandY + 11}" class="gaplabel" text-anchor="middle">官方大纲未覆盖 ${g.minutes}min</text>`;
    }
  }

  // ---------- 热力网格 ----------
  const cellMax = r.grid.cellMax || 1;
  rows.forEach((row, ri) => {
    const yy = gridY + ri * rowH;
    const total = row.counts.reduce((a, b) => a + b, 0);
    out += `<rect x="10" y="${yy + 6}" width="7" height="7" rx="2" fill="${TYPE_COLOR[row.type]}"/>`;
    out += `<text x="22" y="${yy + 14}" class="rowlabelT">${TYPE_LABEL[row.type]}</text>`;
    out += `<text x="${padL - 8}" y="${yy + 14}" class="rowtotal" text-anchor="end">${total}</text>`;
    row.counts.forEach((c, bi) => {
      const x1 = x(bi * B);
      const w = Math.max(1, x((bi + 1) * B) - x1 - 1.2);
      if (c === 0) {
        out += `<rect x="${n(x1)}" y="${yy + 2}" width="${n(w)}" height="${rowH - 4}" fill="#171a22"/>`;
        return;
      }
      const a = 0.22 + 0.78 * Math.pow(c / cellMax, 0.55);
      out += `<rect x="${n(x1)}" y="${yy + 2}" width="${n(w)}" height="${rowH - 4}" fill="${TYPE_COLOR[row.type]}" fill-opacity="${a.toFixed(2)}" class="cell" data-t="${bi * B}" data-type="${row.type}"><title>${fmtTime(bi * B)} · ${TYPE_LABEL[row.type]} ${c} 张</title></rect>`;
    });
  });

  // ---------- 合计行：一张图看「这个时刻总共被标了多少张」 ----------
  {
    const yy = gridY + rows.length * rowH;
    const maxTotal = Math.max(1, ...r.grid.totals);
    const sum = r.grid.totals.reduce((a, b) => a + b, 0);
    out += `<rect x="10" y="${yy + 6}" width="7" height="7" rx="2" fill="#8b91a3"/>`;
    out += `<text x="22" y="${yy + 14}" class="rowlabelT">合计</text>`;
    out += `<text x="${padL - 8}" y="${yy + 14}" class="rowtotal" text-anchor="end">${sum}</text>`;
    r.grid.totals.forEach((c, bi) => {
      const x1 = x(bi * B);
      const w = Math.max(1, x((bi + 1) * B) - x1 - 1.2);
      if (!c) {
        out += `<rect x="${n(x1)}" y="${yy + 2}" width="${n(w)}" height="${rowH - 4}" fill="#12141a"/>`;
        return;
      }
      const a = 0.2 + 0.8 * Math.pow(c / maxTotal, 0.6);
      out += `<rect x="${n(x1)}" y="${yy + 2}" width="${n(w)}" height="${rowH - 4}" fill="#e8e9ee" fill-opacity="${a.toFixed(2)}" class="cell" data-t="${bi * B}" data-type="all"><title>${fmtTime(bi * B)} · 共 ${c} 张</title></rect>`;
    });
  }

  // ---------- 选中区 ----------
  if (opts.selected) {
    const x1 = x(opts.selected.t0);
    const w = Math.max(3, x(opts.selected.t1) - x1);
    out += `<rect x="${n(x1)}" y="${gridY - 2}" width="${n(w)}" height="${gridH + 4}" class="selbox"/>`;
  }

  // ---------- 时间轴 ----------
  const stepT = tEnd > 5400 ? 900 : tEnd > 2400 ? 600 : 300;
  for (let t = 0; t <= tEnd; t += stepT) {
    out += `<line x1="${n(x(t))}" y1="${gridY + gridH}" x2="${n(x(t))}" y2="${gridY + gridH + 4}" class="tick"/>`;
    out += `<text x="${n(x(t))}" y="${axisY}" class="axis" text-anchor="middle">${fmtTime(t)}</text>`;
  }
  out += `<text x="${W - padR}" y="${axisY}" class="axis" text-anchor="end">每格 ${B / 60} 分钟</text>`;

  return `<svg viewBox="0 0 ${W} ${H}" class="heatmap" role="img" aria-label="观众记住卡热力图">
    <defs><linearGradient id="tgrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#8b91a3" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#8b91a3" stop-opacity="0"/>
    </linearGradient></defs>
    ${out}
  </svg>`;
}
