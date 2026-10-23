/**
 * ReLive 数据面板
 * 只读数据契约（public/data/contract/*），不直接调接口、不碰密钥。
 *
 * 两种视图：回放（7 条）/ 场次（17 条）
 * 数据源：直播并发（单日）、场次统计、录制文件官方大纲 + 现成 SRT、互动（0 条，格式已冻结）
 */
import {
  avgOf, completeness, detectDrops, eventsIn, fmtPct, fmtTime,
  segmentRisks, tierLabel, topicAt,
} from './analysis';
import { renderSpark, renderTimeline, renderTopicBars } from './chart';
import type { Curve, Interactions, Replay, ReplaysFile, Session, SessionsFile, Topics } from './types';

const BASE = '/data/contract';

type ViewMode = 'replay' | 'session';
type Point = { t: number; v: number };

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`元素不存在: ${sel}`);
  return el;
};

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

interface Bundle {
  session: Session;
  curve: Curve | null;
  topics: Topics | null;
  interactions: Interactions | null;
}

let allSessions: Session[] = [];
let allReplays: Replay[] = [];
let sessionsMeta: SessionsFile['meta'] | null = null;
let viewMode: ViewMode = 'replay';
let activeKey = '';
const sparks: Record<string, Point[]> = {};

async function loadBundle(s: Session): Promise<Bundle> {
  const [curve, topics, interactions] = await Promise.all([
    getJson<Curve>(`${BASE}/curves/${s.sessionId}.json`),
    getJson<Topics>(`${BASE}/topics/${s.sessionId}.json`),
    getJson<Interactions>(`${BASE}/interactions/${s.sessionId}.json`),
  ]);
  return { session: s, curve, topics, interactions };
}

const sessionOf = (sessionId: string | null): Session | null =>
  sessionId ? allSessions.find((s) => s.sessionId === sessionId) ?? null : null;

const peakOfSession = (sessionId: string | null): number => {
  if (!sessionId) return 0;
  const pts = sparks[sessionId];
  return pts ? pts.reduce((m, p) => Math.max(m, p.v), 0) : 0;
};

function sourceBadge(src: string): string {
  const label = src === 'real' ? '真实' : src === 'sdk' ? 'SDK' : '模拟';
  return `<span class="badge src-${src}">${label}</span>`;
}

function marks(hasCurve: boolean, hasTopics: boolean): string {
  return [
    hasCurve ? '<i class="mk ok" title="有曲线">曲</i>' : '<i class="mk off" title="无曲线">曲</i>',
    hasTopics ? '<i class="mk ok" title="有内容章节">章</i>' : '<i class="mk off" title="无内容章节">章</i>',
    '<i class="mk off" title="无互动">互</i>',
  ].join('');
}

// ---------------- 左栏 ----------------
function renderSidebar(): void {
  $('#sessions').innerHTML = viewMode === 'replay' ? renderReplayRows() : renderSessionRows();
  document.querySelectorAll<HTMLButtonElement>('.sess').forEach((b) => {
    b.addEventListener('click', () => {
      const key = b.dataset.key ?? '';
      if (viewMode === 'replay') {
        const r = allReplays.find((x) => x.videoId === key);
        if (r) void openReplay(r);
      } else {
        const s = sessionOf(key);
        if (s) void openSession(s);
      }
    });
  });
}

function renderReplayRows(): string {
  return allReplays.map((r) => {
    const bound = Boolean(r.sessionId);
    return `<button class="sess ${r.videoId === activeKey ? 'on' : ''}" data-key="${esc(r.videoId)}">
      <div class="sessTop">
        <span class="day">${r.kind === 'vod' ? '点播 <i class="tagVod">VOD</i>' : '回放'}${bound ? '' : ' <i class="tagUnbound">未绑定</i>'}</span>
        <span class="dur">${r.durationMin}min</span>
      </div>
      <div class="sessTitle">${esc(r.title.slice(0, 24))}</div>
      <div class="sessBottom">
        <span class="peak">${bound ? '峰 ' + peakOfSession(r.sessionId) : '—'}</span>
        <span class="uv mono">${esc(r.videoId.slice(0, 8))}</span>
        <span class="marks">${marks(Boolean(r.hasCurve), Boolean(r.hasTopics))}</span>
      </div>
      ${sparks[r.sessionId ?? ''] ? renderSpark(sparks[r.sessionId ?? '']) : '<div class="sparkEmpty">无曲线</div>'}
    </button>`;
  }).join('');
}

function renderSessionRows(): string {
  return allSessions.map((s) => `<button class="sess ${s.sessionId === activeKey ? 'on' : ''}" data-key="${esc(s.sessionId)}">
      <div class="sessTop">
        <span class="day">${s.day}${s.alignment?.grade === 'verified' ? ' <i class="tagOk">已验证</i>' : ''}</span>
        <span class="dur">${s.durationMin}min</span>
      </div>
      <div class="sessTitle">${esc(s.title.slice(0, 24))}</div>
      <div class="sessBottom">
        <span class="peak">峰 ${s.maxConcurrency}</span>
        <span class="uv">观 ${s.uniqueViewer}</span>
        <span class="marks">${marks(Boolean(s.hasCurve), Boolean(s.hasTopics))}</span>
      </div>
      ${sparks[s.sessionId] ? renderSpark(sparks[s.sessionId]) : '<div class="sparkEmpty">无曲线</div>'}
    </button>`).join('');
}

// ---------------- 主区 ----------------
function kpi(label: string, value: string, sub = ''): string {
  return `<div class="kpi"><div class="kpiLabel">${label}</div><div class="kpiValue">${value}</div>${sub ? `<div class="kpiSub">${sub}</div>` : ''}</div>`;
}

function alignmentBadge(session: Session): string {
  const al = session.alignment;
  if (!al) return '<span class="alNone">无录制文件</span> · 没有内容章节（官方大纲/字幕），只能出场次级体检';
  if (al.grade === 'verified') {
    return `<span class="alOk">对齐已验证</span> · 录制起点偏移 ${al.offsetSec}s · 时长差 ${al.durationDeltaSec}s · 录制文件 <span class="mono">${esc(al.fileId.slice(0, 8))}</span>`;
  }
  return `<span class="alWeak">对齐待确认</span> · 偏移 ${al.offsetSec}s · 时长差 ${al.durationDeltaSec}s`;
}

function renderMain(b: Bundle, replay: Replay | null): void {
  const { session, curve, topics, interactions } = b;
  const comp = completeness(session, curve, topics, interactions);
  const det = detectDrops(curve, topics, interactions);

  $('#kpis')!.innerHTML = [
    kpi('独立观众', String(session.uniqueViewer), `${session.playCount} 次播放`),
    kpi('峰值并发', String(session.maxConcurrency), curve ? `均 ${avgOf(curve.points).toFixed(1)} 人` : '无曲线'),
    kpi('平均观看', `${session.avgPlayDurationMin} 分钟`, `时长 ${session.durationMin} 分钟`),
    kpi('内容章节', topics ? String(topics.segments.length) : '—', topics ? `${topics.cues} 条字幕` : '无录制文件'),
  ].join('');

  const playUrl = replay?.watchUrl ?? session.watchUrl;
  $('#headline')!.innerHTML = `
    <div class="hlLeft">
      <h1>${esc(replay?.title ?? session.title)}</h1>
      <div class="hlMeta">
        <span>${replay ? (replay.kind === 'vod' ? '点播原片' : '直播回放') : '直播场次'}</span><span>·</span>
        <span>${session.durationMin} 分钟</span><span>·</span>
        <span class="mono">${esc(replay?.videoId ?? session.sessionId)}</span>
        ${playUrl ? `<a href="${esc(playUrl)}" target="_blank" rel="noreferrer">打开播放页 ↗</a>` : ''}
      </div>
      <div class="bindRow">${alignmentBadge(session)}</div>
      <div class="bindRow">${
        replay
          ? replay.sessionId
            ? `已绑定场次 <span class="mono">${esc(replay.sessionId)}</span>（${esc(replay.matchedBy ?? '')}）`
            : `<span class="warn">未绑定直播场次</span> · ${esc(replay.bindNote ?? '无匹配场次')}`
          : `源场次 <span class="mono">${esc(session.sessionId)}</span>`
      }</div>
    </div>
    <div class="hlRight">
      <span class="tier tier-${comp.tier}">完整度 ${tierLabel(comp.tier)}</span>
      ${sourceBadge(session.source)}
    </div>`;

  const chartEl = $('#chart')!;
  if (curve) {
    chartEl.innerHTML = `
      ${renderTimeline({ curve, topics, events: interactions?.events ?? [], drops: det.drops })}
      <div class="legend">
        <span><i class="lgLine"></i>在线人数</span>
        <span><i class="lgBand"></i>内容章节（官方大纲）</span>
        <span><i class="lgDrop"></i>掉人点</span>
        <span><i class="lgEv"></i>互动事件</span>
      </div>`;
  } else if (topics) {
    chartEl.innerHTML = `
      <div class="noCurve">本场无人数曲线，降级为「内容结构」视图：按官方章节看时长与互动钩子。</div>
      ${renderTopicBars(topics, segmentRisks(topics))}`;
  } else {
    chartEl.innerHTML = `<div class="noCurve">无曲线也无内容章节（该场没有录制文件），仅能出场次级体检。</div>`;
  }

  const riskCards = det.gated
    ? `<div class="gated">${esc(det.reason ?? '样本不足')}<br/><span class="dim">掉人点归因已自动关闭，避免把噪声当洞察。</span></div>`
    : det.drops.length === 0
      ? `<div class="gated">未发现显著掉人点（全场跌幅均在基线附近）。</div>`
      : det.drops.map((d, i) => `
        <article class="card">
          <header><b>#${i + 1}</b> ${fmtTime(d.tStart)}-${fmtTime(d.tEnd)} <span class="risk">${fmtPct(d.drop)}</span></header>
          <div class="kv"><span>人数</span><b>${d.from} → ${d.to}</b></div>
          <div class="kv"><span>当时在讲</span><b>${esc(d.topic ?? '未知')}</b></div>
          <div class="kv"><span>归因</span><b class="cause">${esc(d.cause)}</b></div>
          <div class="kv"><span>判据</span><span class="dim">${esc(d.rule)}</span></div>
          <div class="fix">改法：${esc(d.fix)}</div>
          <div class="conf">置信度 <b>${d.confidence}</b>${interactions?.events.length ? '' : ' · 无互动数据佐证'}</div>
        </article>`).join('');

  const segNow = det.drops[0] ? topicAt(topics, det.drops[0].tStart) : null;
  const evNow = det.drops[0] ? eventsIn(interactions, det.drops[0].tStart, det.drops[0].tEnd) : [];

  $('#report')!.innerHTML = `
    <h2>归因</h2>
    ${riskCards}
    ${segNow ? `<div class="evidence">
        <div class="evTitle">证据链</div>
        <div class="evBody">该时刻属于官方章节「${esc(segNow.topic)}」（${fmtTime(segNow.startSec)}-${fmtTime(segNow.rawEndSec ?? segNow.endSec)}，${segNow.cues} 条字幕）。</div>
        <div class="evQuote">…${esc(segNow.text.slice(0, 96))}…</div>
        <div class="evBody">章节内互动事件：${evNow.length} 条${evNow.length ? '' : '（本场无互动数据）'}</div>
      </div>` : ''}
    ${interactions?.events.length ? '' : `<div class="ipl">
        <div class="evTitle">互动线：0 条 · 格式已冻结</div>
        <div class="evBody">本账号实测无任何互动记录（抽奖/签到/答题/问卷/点赞全为 0）。事件格式定义在
          <span class="mono">contract/interactions/_schema.json</span>；后续模拟数据按同格式写入
          <span class="mono">source: "sim"</span> 即可被引擎直接消费，前端无需改动。</div>
      </div>`}
    <h2>数据完整度</h2>
    <div class="comp">
      <div class="compRow"><span class="ok">有</span>${comp.has.map(esc).join(' · ')}</div>
      <div class="compRow"><span class="off">缺</span>${comp.missing.length ? comp.missing.map(esc).join(' · ') : '无'}</div>
      <ul class="notes">${comp.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    </div>`;
}

function renderUnbound(r: Replay): void {
  $('#kpis')!.innerHTML = [
    kpi('回放时长', `${r.durationMin} 分钟`, '来自回放列表'),
    kpi('绑定场次', '未绑定', '无外键，不猜'),
    kpi('人数曲线', '不可用', '缺 sessionId'),
    kpi('内容章节', '不可用', '无录制文件'),
  ].join('');

  $('#headline')!.innerHTML = `
    <div class="hlLeft">
      <h1>${esc(r.title)}</h1>
      <div class="hlMeta">
        <span>直播回放</span><span>·</span><span>${r.durationMin} 分钟</span><span>·</span>
        <span class="mono">${esc(r.videoId)}</span>
        ${r.watchUrl ? `<a href="${esc(r.watchUrl)}" target="_blank" rel="noreferrer">打开播放页 ↗</a>` : ''}
      </div>
      <div class="bindRow"><span class="warn">未绑定直播场次</span> · ${esc(r.bindNote ?? '无匹配场次')}</div>
    </div>
    <div class="hlRight"><span class="tier tier-C">完整度 C · 仅元数据</span>${sourceBadge('real')}</div>`;

  $('#chart')!.innerHTML = `<div class="noCurve">这条回放拿不到直播场次，因此没有人数的分钟曲线、没有内容章节。
    原因：回放列表接口（/live/v4/channel/playback/list）只返回 videoId / 时长 / 标题 / 播放地址，不含 sessionId；
    能提供映射的是 /live/v4/channel/record-file/list（带 channelSessionId + 字幕 + 大纲），但它只保留最近几场的录制文件。</div>`;

  $('#report')!.innerHTML = `
    <h2>为什么没有数据</h2>
    <div class="evidence">
      <div class="evBody">① 回放视频与直播场次在保利威侧没有直接外键；</div>
      <div class="evBody">② 能提供映射的录制文件接口只保留最近 4 场（本账号）；</div>
      <div class="evBody">③ 因此这条回放只能按「时长 ±60 秒且候选唯一」尝试绑定，绑不上就留空 —— 不猜。</div>
    </div>
    <h2>怎么补</h2>
    <div class="evidence">
      <div class="evBody">在 replays.json 里手工填入 sessionId，面板会自动带上曲线、章节与归因。</div>
    </div>`;
}

// ---------------- 交互 ----------------
async function openSession(s: Session): Promise<void> {
  activeKey = s.sessionId;
  renderSidebar();
  renderMain(await loadBundle(s), null);
}

async function openReplay(r: Replay): Promise<void> {
  activeKey = r.videoId;
  renderSidebar();
  const s = sessionOf(r.sessionId);
  if (!s) {
    renderUnbound(r);
    return;
  }
  renderMain(await loadBundle(s), r);
}

/** 场次排序：曲线+章节都有 > 有曲线 > 有章节 */
function score(s: Session): number {
  if (s.hasCurve && s.hasTopics) return 5000 + peakOfSession(s.sessionId);
  if (s.hasCurve) return 2000 + peakOfSession(s.sessionId);
  return s.hasTopics ? 1000 : 0;
}

function renderTabs(): void {
  const live = sessionsMeta?.counts?.liveSessions ?? allSessions.length;
  const pb = sessionsMeta?.counts?.playbacks ?? 0;
  $('#tabs')!.innerHTML = `
    <button class="tab ${viewMode === 'replay' ? 'on' : ''}" data-mode="replay">回放 ${allReplays.length}</button>
    <button class="tab ${viewMode === 'session' ? 'on' : ''}" data-mode="session">场次 ${live}</button>
    <span class="tabNote">回放 ${pb} 条 + 点播 1 条；场次含测试短场</span>`;
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => {
    b.addEventListener('click', () => {
      viewMode = (b.dataset.mode as ViewMode) ?? 'replay';
      activeKey = '';
      renderTabs();
      renderSidebar();
      if (viewMode === 'replay') {
        const first = [...allReplays].sort((x, y) => peakOfSession(y.sessionId) - peakOfSession(x.sessionId))[0];
        if (first) void openReplay(first);
      } else {
        const first = [...allSessions].sort((x, y) => score(y) - score(x))[0];
        if (first) void openSession(first);
      }
    });
  });
}

async function boot(): Promise<void> {
  const [sf, rf] = await Promise.all([
    getJson<SessionsFile>(`${BASE}/sessions.json`),
    getJson<ReplaysFile>(`${BASE}/replays.json`),
  ]);
  if (!sf) {
    $('#app')!.innerHTML = '<p class="err">读不到数据契约。先跑 node scripts/build-topics.mjs 再 node scripts/normalize.mjs。</p>';
    return;
  }
  allSessions = sf.sessions;
  sessionsMeta = sf.meta;
  allReplays = rf?.replays ?? [];

  const curves = await Promise.all(allSessions.map((s) => getJson<Curve>(`${BASE}/curves/${s.sessionId}.json`)));
  allSessions.forEach((s, i) => {
    const c = curves[i];
    if (c) sparks[s.sessionId] = c.points;
  });

  $('#app')!.innerHTML = `
    <header class="top">
      <div class="brand">ReLive<span class="brandSub">直播复盘 · 数据面板</span></div>
      <div class="topMeta">
        <span>频道 ${sf.meta.channelId}</span>
        <span>${sf.meta.counts?.liveSessions ?? allSessions.length} 直播场次</span>
        <span>${sf.meta.counts?.withTopics ?? 0} 场有内容章节</span>
        <span>${sf.meta.counts?.verifiedAlignment ?? 0} 场对齐已验证</span>
        <span>${sourceBadge(sf.meta.source)}</span>
      </div>
    </header>
    <div class="layout">
      <aside class="side">
        <div id="tabs" class="tabs"></div>
        <div id="sessions" class="sessions"></div>
      </aside>
      <main class="main">
        <section id="headline" class="headline"></section>
        <section id="kpis" class="kpis"></section>
        <section class="panel">
          <div class="panelHead">三线时间轴<small>人数 × 内容章节 × 互动，共用一根秒轴</small></div>
          <div id="chart" class="chart"></div>
        </section>
        <section class="panel"><div id="report" class="report"></div></section>
        <footer class="foot">
          <p><b>完全在直播侧取数。</b>场次与人数曲线来自直播统计接口；内容章节来自「直播录制文件」的官方 AI 大纲 + 现成 SRT 字幕（record-file/list 的 channelSessionId 提供与场次的映射，时间轴已验证：录制起点偏移 ≤2s、时长差 ≤2s）。互动线实测 0 条，格式已冻结，等待后续注入模拟数据。</p>
          <p>契约 <code>data-contract.md</code> · 生成 <code>scripts/build-topics.mjs</code> + <code>scripts/normalize.mjs</code></p>
        </footer>
      </main>
    </div>`;

  const ranked = [...allSessions].sort((a, b) => score(b) - score(a));
  const first = ranked[0];
  viewMode = 'session';
  renderTabs();
  if (first) await openSession(first);
  else renderSidebar();
}

void boot();
