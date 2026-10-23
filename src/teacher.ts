/**
 * 教师端复盘台 —— 观众「记住卡」的实时汇总、热力图与诊断
 *
 * 数据只有一条来源：观众端上报的卡片 → /api/teacher 聚合。
 * 一条铁律：屏幕上每一句判断旁边都必须有能点开的数字。
 */
import { renderHeatmap, TYPE_COLOR, TYPE_LABEL } from './heatmap';
import { fmtTime } from './analysis';
import type { CardType, CardsFile, MemoryCard, TeacherFinding, TeacherReport } from './types';

const APP = document.getElementById('app');
if (!APP) throw new Error('#app not found');

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SPEC: Record<string, { level: string; cls: string }> = {
  high: { level: '要处理', cls: 'lvHigh' },
  medium: { level: '可优化', cls: 'lvMid' },
  low: { level: '待确认', cls: 'lvLow' },
};

interface Sel {
  t0: number;
  t1: number;
  label: string;
}

interface TeacherConfig {
  channelId?: string;
  videoKey?: string;
}

/** 服务端在 /teacher 注入的默认视频（和观众端默认播放的是同一条） */
function readTeacherConfig(): TeacherConfig {
  if (typeof window === 'undefined') return {};
  const raw = (window as unknown as { __TEACHER_CONFIG__?: TeacherConfig }).__TEACHER_CONFIG__;
  return raw && typeof raw === 'object' ? raw : {};
}

let report: TeacherReport | null = null;
let cardFile: CardsFile | null = null;
let sel: Sel | null = null;
let currentVk = '';

const PARAMS =
  typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const INJECTED = readTeacherConfig();
const LIVE_CHANNEL = PARAMS.get('channelId') || INJECTED.channelId || '4711207';
const LIVE_POLL_MS = 8000;
let liveTimer: number | null = null;

interface NotesResponse {
  notes: {
    id: string;
    time: number;
    type: CardType;
    summary: string;
    subtitle: string;
    visitorId: string;
  }[];
}

/** 侧栏的一条点播场次 */
interface VodSession {
  videoKey: string;
  vid: string;
  title: string;
  duration: number;
  creationTime: string;
  cards: number;
  viewers: number;
}

let sessions: VodSession[] = [];
let searchQuery = '';

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/**
 * 「回到学生点播」——老师看完复盘，下一步往往是"把这段找出来再听一遍"。
 * 所以直接回到秒记卡的播放页，并带上同一视频 + 同一秒。
 */
function studentTarget(): { channelId: string; source: string; id: string } {
  const vk = (report?.videoKey || currentVk || '').split(':');
  if (vk.length === 2 && vk[1]) {
    return { channelId: LIVE_CHANNEL, source: vk[0], id: vk[1] };
  }
  return { channelId: LIVE_CHANNEL, source: '', id: '' };
}

function studentUrl(t = 0): string {
  const { channelId, source, id } = studentTarget();
  const query = new URLSearchParams();
  query.set('channelId', channelId);
  if (source) query.set('source', source);
  if (id) query.set('id', id);
  query.set('t', String(Math.max(0, Math.round(t))));
  return `/?${query.toString()}`;
}

/* ---------------- 实时模式 ---------------- */

function applyLive(rep: TeacherReport, notes: NotesResponse | null): void {
  report = rep;
  cardFile = notes
    ? {
        sessionId: rep.sessionId,
        source: 'real',
        viewers: rep.scale.viewers,
        cards: notes.notes.map((n) => ({
          id: n.id,
          t: n.time,
          cue: 0,
          quote: n.summary || n.subtitle,
          chapterId: null,
          chapter: null,
          type: n.type,
          viewer: n.visitorId,
          note: n.subtitle,
        })),
      }
    : null;
}

async function loadLive(vk: string): Promise<void> {
  currentVk = vk;
  const q = encodeURIComponent(vk);
  const [rep, notes] = await Promise.all([
    getJson<TeacherReport>(`/api/teacher/${q}?channelId=${LIVE_CHANNEL}`),
    getJson<NotesResponse>(`/api/notes/${LIVE_CHANNEL}/${q}`),
  ]);
  if (!rep) {
    APP!.innerHTML = `<p class="err">载入失败：/api/teacher/${esc(vk)} —— 确认 npm start 已经起来（8787）。</p>`;
    return;
  }
  applyLive(rep, notes);
  sel = null;
  render();
  if (liveTimer) window.clearInterval(liveTimer);
  liveTimer = window.setInterval(() => {
    void refreshLive(vk);
  }, LIVE_POLL_MS);
}

/** 定时拉一次；数据没变就不重绘，避免演示时闪 */
async function refreshLive(vk: string): Promise<void> {
  if (!report) return;
  const q = encodeURIComponent(vk);
  const before = JSON.stringify(sessions.map((s) => [s.videoKey, s.cards]));
  const [rep, notes] = await Promise.all([
    getJson<TeacherReport>(`/api/teacher/${q}?channelId=${LIVE_CHANNEL}`),
    getJson<NotesResponse>(`/api/notes/${LIVE_CHANNEL}/${q}`),
    refreshSessions(),
  ]);
  const after = JSON.stringify(sessions.map((s) => [s.videoKey, s.cards]));
  if (!rep) return;
  if (rep.scale.cards === report.scale.cards && before === after) return;
  const keep = sel;
  applyLive(rep, notes);
  sel = keep;
  render();
}

async function refreshSessions(): Promise<void> {
  const data = await getJson<{ sessions?: VodSession[] }>(
    `/api/vod-sessions?channelId=${LIVE_CHANNEL}`,
  );
  if (Array.isArray(data?.sessions)) sessions = data.sessions;
}

/** 侧栏点某一场 → 切到那一场的复盘 */
async function selectSession(vk: string): Promise<void> {
  if (!vk || vk === currentVk) return;
  sel = null;
  await loadLive(vk);
  try {
    const u = new URL(location.href);
    u.searchParams.set('vk', vk);
    history.replaceState(null, '', u.toString());
  } catch {
    /* 忽略 */
  }
}

/* ---------------- 分块渲染 ---------------- */

/** 列表行（不含"当前课程"那条） */
function renderSessionRow(s: VodSession): string {
  const date = s.creationTime ? s.creationTime.slice(2, 10) : '';
  const minutes = s.duration ? Math.round(s.duration / 60) : 0;
  const badge = s.cards
    ? `<span class="vsCards">${s.cards} 张</span>`
    : '<span class="vsCards vsCards--zero">暂无卡片</span>';
  return `<button class="vsess" data-vk="${esc(s.videoKey)}" title="${esc(s.title)}">
    <span class="vsTop"><span class="vsDate">${esc(date)}</span>${badge}</span>
    <span class="vsTitle">${esc(s.title)}</span>
    <span class="vsMeta">${minutes} 分钟${s.viewers ? ` · ${s.viewers} 人` : ''}</span>
  </button>`;
}

/** 搜索 + 时间倒序的课程列表 */
function renderSessionList(): string {
  const q = searchQuery.trim().toLowerCase();
  const list = sessions
    .filter((s) => s.videoKey !== currentVk)
    .filter((s) => !q || s.title.toLowerCase().includes(q))
    .sort((a, b) => String(b.creationTime).localeCompare(String(a.creationTime)));

  if (!list.length) {
    return `<p class="vsEmpty">${q ? '未搜索到对应课程' : '没有其它点播课程'}</p>`;
  }
  return list.map(renderSessionRow).join('');
}

function renderSidebar(): string {
  const r = report!;
  const current = sessions.find((s) => s.videoKey === currentVk);
  const date = current?.creationTime ? current.creationTime.slice(2, 10) : '';
  const minutes = Math.round(r.scale.durationSec / 60);

  return `<div class="vlistHead"><span>当前课程</span></div>
    <button class="vsess vsess--current on" data-live-refresh="1" title="点一下手动刷新">
      <span class="vsTop"><span class="vsDate">${esc(date)}${date ? ' · ' : ''}每 ${LIVE_POLL_MS / 1000} 秒刷新</span><span class="vsCards">${r.scale.cards} 张</span></span>
      <span class="vsTitle">${esc(r.title || current?.title || currentVk)}</span>
      <span class="vsMeta">${minutes} 分钟 · ${r.scale.viewers} 人参与</span>
    </button>

    <div class="vsSearchWrap">
      <input id="vs-search" class="vsSearch" type="search" placeholder="搜索课程名…"
        autocomplete="off" value="${esc(searchQuery)}" />
    </div>

    <div class="vlistHead"><span>全部点播</span><span class="vlistCount">${sessions.length}</span></div>
    <div class="vlist" id="vs-list">${renderSessionList()}</div>`;
}

function renderBadges(): string {
  const r = report!;
  const cards = r.source.cards === 'sim' ? '<span class="bdg bdgSim">观众卡片：模拟</span>' : '<span class="bdg bdgReal">观众卡片：真实</span>';
  const ch = r.source.chapters === 'none'
    ? '<span class="bdg bdgOff">章节：无（未生成 AI 大纲）</span>'
    : '<span class="bdg bdgReal">章节：官方 AI 大纲</span>';
  const cv = r.source.curve === 'none'
    ? '<span class="bdg bdgOff">人数曲线：无</span>'
    : '<span class="bdg bdgReal">人数曲线：真实</span>';
  const ai = r.engine.narrative === 'offline-model'
    ? '<span class="bdg bdgAI">AI 解读：离线模型</span>'
    : '<span class="bdg bdgOff">AI 解读：模板</span>';
  return cards + ch + cv + ai;
}

function renderKpis(): string {
  const r = report!;
  const it: [string, string, string][] = [
    ['参与的观众', `${r.scale.viewers}`, '人'],
    ['记住卡', `${r.scale.cards}`, `张 · 人均 ${r.scale.perViewer}`],
    ['卡片密度', `${r.scale.perMin}`, '张/分钟'],
    ['内容章节', `${r.scale.chapters}`, '段'],
    ['时长', `${r.scale.durationMin}`, '分钟'],
    ['人数峰值', r.scale.peak == null ? '—' : `${r.scale.peak}`, r.curveGate.usable ? '人 · 可交叉判断' : r.source.curve === 'none' ? '人 · 本场无人数数据' : '人 · 仅展示'],
  ];
  return `<div class="kpis">${it
    .map(([k, v, u]) => `<div class="kpi"><div class="kpiK">${k}</div><div class="kpiV">${v}<i>${u}</i></div></div>`)
    .join('')}</div>`;
}

function renderFinding(f: TeacherFinding): string {
  const s = SPEC[f.level] ?? SPEC.low;
  const ev = f.evidence.map((e) => `<span class="ev"><b>${esc(e.k)}</b>${esc(e.v)}</span>`).join('');
  const act = f.action ? `<div class="fact"><span class="factK">下一步</span>${esc(f.action)}</div>` : '';
  return `<article class="finding ${s.cls}" data-fid="${esc(f.id)}">
    <div class="fhead">
      <span class="lvl">${s.level}</span>
      <h3>${esc(f.title)}</h3>
      <span class="ftime">${fmtTime(f.t0)}–${fmtTime(f.t1)}</span>
    </div>
    <div class="evs">${ev}</div>
    <p class="fjudge">${esc(f.judgment)}</p>
    ${act}
    <div class="facts">
      <button class="mini" data-range="${f.t0},${f.t1}" data-fid="${esc(f.id)}">在图上看这段</button>
      <a class="mini ghost" href="${studentUrl(f.t0)}">去学生端看这段</a>
    </div>
  </article>`;
}

function renderAI(): string {
  const r = report!;
  if (!r.verdict) return '';
  const plan = (r.plan ?? []).map((p, i) => `<li><span class="pn">${i + 1}</span>${esc(p)}</li>`).join('');
  const rel = r.reliability.level === 'ok' ? '' : `<div class="warn">${esc(r.reliability.reason)}</div>`;
  return `<div class="panel aiPanel">
    <div class="phead">
      <h2>AI 复盘结论</h2>
      <span class="pm">${r.engine.narrative === 'offline-model' ? '离线模型生成 · 数字由规则引擎提供' : '模板生成'}</span>
    </div>
    <p class="verdict">${esc(r.verdict)}</p>
    ${rel}
    ${plan ? `<div class="planT">下一期就改这三件</div><ol class="plan">${plan}</ol>` : ''}
  </div>`;
}

/** 匿名观众 ID 通常是 UUID，列表里只显示尾部 4 位，避免撑破卡片 */
const shortViewer = (id: string): string => (id.length > 10 ? `…${id.slice(-4)}` : id);

function renderCard(c: MemoryCard): string {
  const note = c.note ? `<div class="cnote">${esc(c.note)}</div>` : '';
  return `<div class="mcard" style="border-left-color:${TYPE_COLOR[c.type]}">
    <div class="cm">
      <span class="ct">${fmtTime(c.t)}</span>
      <span class="cx" style="color:${TYPE_COLOR[c.type]}">${TYPE_LABEL[c.type]}</span>
      <span class="cv">${esc(shortViewer(c.viewer))}</span>
    </div>
    <div class="cq">${esc(c.quote)}</div>
    ${note}
  </div>`;
}

function renderCards(): string {
  const r = report!;
  const all = cardFile?.cards ?? [];
  const list = (sel ? all.filter((c) => c.t >= sel!.t0 && c.t < sel!.t1) : all).slice().sort((a, b) => a.t - b.t);
  const head = sel
    ? `<div class="phead"><h2>卡片流</h2><span class="pm">${esc(sel.label)} · ${list.length} 张</span><button class="mini" data-clear="1">看全部 ${all.length} 张</button></div>`
    : `<div class="phead"><h2>卡片流</h2><span class="pm">全部 ${list.length} 张 · 按时间排序 · 点热力格可筛选</span></div>`;
  const body = list.length
    ? `<div class="cgrid">${list.map(renderCard).join('')}</div>`
    : `<div class="empty">这段没有卡片</div>`;
  const cnt = r.scale.byType;
  const legend = (['question', 'fix', 'step', 'key', 'case'] as CardType[])
    .filter((t) => (cnt[t] ?? 0) > 0)
    .map((t) => `<span class="lgd"><i style="background:${TYPE_COLOR[t]}"></i>${TYPE_LABEL[t]} ${cnt[t]}</span>`)
    .join('');
  return `<div class="panel">
    ${head}
    <div class="lgds">${legend}</div>
    ${body}
  </div>`;
}

function render(): void {
  const r = report!;
  const svg = renderHeatmap(r, { selected: sel });
  const findings = r.findings.map(renderFinding).join('');
  const highN = r.findings.filter((f) => f.level === 'high').length;
  // 整页重绘会重建搜索框，先把焦点和光标位置记下来
  const activeEl = document.activeElement as HTMLElement | null;
  const searchFocused = activeEl?.id === 'vs-search';
  const caret = searchFocused ? (activeEl as HTMLInputElement).selectionStart : null;

  APP!.innerHTML = `
  <header class="top">
    <div class="brand">ReLive<span class="brandSub">教师端 · 观众记住卡复盘</span></div>
    <div class="topMeta">${renderBadges()}</div>
  </header>

  <div class="tlayout">
    <aside class="tleft">${renderSidebar()}</aside>
    <main class="tmain">
      <div class="thead">
        <h1>${esc(r.title || r.sessionId)}</h1>
        <div class="thmeta">
          <span class="mono">${esc(r.videoKey || r.sessionId)}</span>
          <span>${fmtTime(r.scale.durationSec)}</span>
          <a class="backLink" href="${studentUrl(0)}">← 回到学生点播</a>
        </div>
      </div>

      <div class="note"${r.scale.cards === 0 ? ' hidden' : ''}>${esc(r.reliability.reason)}</div>

      ${renderKpis()}

      <div class="panel">
        <div class="phead">
          <h2>记住卡热力图</h2>
          <span class="pm">横向=时间 · 纵向=卡片类型 · 颜色深浅=标记人数</span>
        </div>
        <div class="heatwrap" id="heat">${svg}</div>
      </div>

      <div class="twocol">
        <div class="colL">
          ${renderAI()}
          <div class="panel">
            <div class="phead"><h2>诊断 ${r.findings.length} 条</h2><span class="pm">${highN} 条要处理 · 每条都带证据</span></div>
            <div class="findings">${findings}</div>
          </div>
        </div>
        <div class="colR">${renderCards()}</div>
      </div>

      <footer class="tfoot">
        数据来源：观众端「记一下」实时上报（<code>POST /api/notes</code>）→
        聚合 <code>GET /api/teacher/&lt;videoKey&gt;</code> ·
        上送格式：<code>data/contract/cards/_schema.json</code>
      </footer>
    </main>
  </div>`;

  // 侧栏列表很长，把当前选中的那条滚到可见位置
  const active = APP!.querySelector('.vsess.on');
  if (active) active.scrollIntoView({ block: 'nearest' });

  if (searchFocused) {
    const input = document.getElementById('vs-search') as HTMLInputElement | null;
    if (input) {
      input.focus();
      const pos = caret ?? input.value.length;
      input.setSelectionRange(pos, pos);
    }
  }
}

/* ---------------- 交互 ---------------- */

// 搜索框只重绘列表，不动输入框本身，避免每敲一个字就丢焦点
APP.addEventListener('input', (ev) => {
  const el = ev.target as HTMLInputElement;
  if (el?.id !== 'vs-search') return;
  searchQuery = el.value;
  const container = document.getElementById('vs-list');
  if (container) container.innerHTML = renderSessionList();
});

APP.addEventListener('click', (ev) => {
  const el = ev.target as HTMLElement;
  if (!el.closest) return;

  const sessionBtn = el.closest('[data-vk]') as HTMLElement | null;
  if (sessionBtn?.dataset.vk) {
    void selectSession(sessionBtn.dataset.vk);
    return;
  }

  if (el.closest('[data-live-refresh]') && currentVk) {
    void loadLive(currentVk);
    return;
  }

  if (el.closest('[data-clear]')) {
    sel = null;
    render();
    return;
  }

  const cell = el.closest('.cell') as unknown as SVGRectElement | null;
  if (cell?.dataset?.t != null) {
    const t = Number(cell.dataset.t);
    const b = report!.bucketSec;
    sel = { t0: t, t1: t + b, label: `${fmtTime(t)}–${fmtTime(t + b)}` };
    render();
    return;
  }

  const rangeBtn = el.closest('[data-range]') as HTMLElement | null;
  if (rangeBtn?.dataset.range) {
    const [a, b] = rangeBtn.dataset.range.split(',').map(Number);
    const f = report!.findings.find((x) => x.id === rangeBtn.dataset.fid);
    sel = { t0: a, t1: b, label: f ? f.title : `${fmtTime(a)}–${fmtTime(b)}` };
    render();
    document.getElementById('heat')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});

/* ---------------- 启动 ---------------- */

/**
 * 视频来源优先级：URL 的 ?vk= → 服务端注入 → 问 /api/channel 拿当前默认视频。
 * 这样打开 /teacher 就等于"复盘观众正在看的那一条"。
 */
async function resolveVideoKey(): Promise<string> {
  const fromQuery = PARAMS.get('vk');
  if (fromQuery) return fromQuery;
  if (INJECTED.videoKey) return INJECTED.videoKey;
  const bundle = await getJson<{ channel?: { videoKey?: string } }>(`/api/channel/${LIVE_CHANNEL}`);
  return bundle?.channel?.videoKey ?? '';
}

await refreshSessions();

const vk = await resolveVideoKey();
if (!vk) {
  APP!.innerHTML = `<p class="err">没能确定要复盘哪条视频：请用 <code>/teacher?vk=vod:&lt;vid&gt;</code> 打开，或先启动服务端。</p>`;
} else {
  currentVk = vk;
  await loadLive(vk);
}
