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
/** 匿名 ID → 「学生 1/2/3」，比一串 UUID 好读 */
let viewerLabels = new Map<string, string>();

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
  viewerLabels = new Map();
  if (notes) {
    for (const n of notes.notes) {
      if (!viewerLabels.has(n.visitorId)) {
        viewerLabels.set(n.visitorId, `学生 ${viewerLabels.size + 1}`);
      }
    }
  }
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
    ? `<span class="nBadge">${s.cards} 张</span>`
    : '<span class="nBadge nBadge--zero">暂无</span>';
  return `<button class="nItem" data-vk="${esc(s.videoKey)}" title="${esc(s.title)}">
    <span class="nTop"><span class="nDate">${esc(date)}</span>${badge}</span>
    <span class="nTitle">${esc(s.title)}</span>
    <span class="nMeta">${minutes} 分钟${s.viewers ? ` · ${s.viewers} 位学生` : ''}</span>
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
    return `<p class="nEmpty">${q ? '未搜索到对应课程' : '没有其它点播课程'}</p>`;
  }
  return list.map(renderSessionRow).join('');
}

function renderNav(): string {
  const r = report!;
  const current = sessions.find((s) => s.videoKey === currentVk);
  const date = current?.creationTime ? current.creationTime.slice(2, 10) : '';
  const minutes = Math.round(r.scale.durationSec / 60);

  return `<aside class="nav">
    <div class="navHead"><span>当前课程</span></div>
    <button class="courseCard" data-live-refresh="1" title="点一下手动刷新">
      <span class="ccTop">
        <span class="ccDate">${esc(date)}</span>
        <span class="ccBadge">${r.scale.cards} 张秒记</span>
      </span>
      <span class="ccTitle">${esc(r.title || current?.title || currentVk)}</span>
      <span class="ccMeta">${minutes} 分钟 · ${r.scale.viewers} 位学生</span>
      <span class="ccLive"><i></i>每 ${LIVE_POLL_MS / 1000} 秒自动刷新</span>
    </button>

    <div class="search">
      <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>
      <input id="vs-search" class="searchInput" type="search" placeholder="搜索课程名"
        autocomplete="off" value="${esc(searchQuery)}" />
    </div>

    <div class="navHead"><span>全部点播</span><span class="count">${sessions.length}</span></div>
    <div class="navList" id="vs-list">${renderSessionList()}</div>
  </aside>`;
}

function renderChips(): string {
  const r = report!;
  const cards = r.source.cards === 'sim'
    ? '<span class="chip"><i></i>卡片：模拟数据</span>'
    : '<span class="chip chip--real"><i></i>卡片：学生实时上报</span>';
  const chapters = r.source.chapters === 'none'
    ? '<span class="chip"><i></i>章节：未生成</span>'
    : '<span class="chip chip--real"><i></i>章节：官方 AI 大纲</span>';
  const nar = r.engine.narrative === 'offline-model'
    ? '<span class="chip chip--real"><i></i>解读：离线模型</span>'
    : '<span class="chip"><i></i>解读：规则模板</span>';
  return cards + chapters + nar;
}

function renderStats(): string {
  const r = report!;
  const items: [string, string, string][] = [
    ['参与学生', `${r.scale.viewers}`, '人'],
    ['秒记总数', `${r.scale.cards}`, '张'],
    ['人均秒记', `${r.scale.perViewer}`, '张/人'],
    ['秒记密度', `${r.scale.perMin}`, '张/分钟'],
  ];
  return `<div class="stats">${items
    .map(([k, v, u]) => `<div class="stat"><div class="statK">${k}</div><div class="statV">${v}<i>${u}</i></div></div>`)
    .join('')}</div>`;
}

/** 秒记类型分布（右侧洞察用） */
function renderDist(): string {
  const r = report!;
  const byType = r.scale.byType ?? {};
  const list = (['key', 'question', 'step', 'case', 'fix'] as CardType[]).filter(
    (t) => (byType[t] ?? 0) > 0,
  );
  const max = Math.max(1, ...list.map((t) => byType[t] ?? 0));
  const rows = list
    .map((t) => {
      const n = byType[t] ?? 0;
      return `<div class="distRow">
        <span class="distLabel">${TYPE_LABEL[t]}</span>
        <span class="distBar"><i style="width:${Math.round((n / max) * 100)}%;background:${TYPE_COLOR[t]}"></i></span>
        <span class="distVal">${n}</span>
      </div>`;
    })
    .join('');
  return `<section class="panel">
    <div class="panelHead"><h2>秒记类型分布</h2><span class="panelHint">共 ${r.scale.cards} 张</span></div>
    <div class="dist">${rows || '<p class="empty">还没有秒记</p>'}</div>
  </section>`;
}

function renderFinding(f: TeacherFinding): string {
  const s = SPEC[f.level] ?? SPEC.low;
  const ev = f.evidence.map((e) => `<span><b>${esc(e.k)}</b>${esc(e.v)}</span>`).join('');
  return `<article class="finding ${s.cls}" data-fid="${esc(f.id)}">
    <div class="fHead">
      <span class="fLevel">${s.level}</span>
      <span class="fTime">${fmtTime(f.t0)}–${fmtTime(f.t1)}</span>
      <h3 class="fTitle">${esc(f.title)}</h3>
    </div>
    <div class="fEv">${ev}</div>
    <p class="fJudge">${esc(f.judgment)}</p>
    <div class="fActs">
      <button class="btn btn--tiny" data-range="${f.t0},${f.t1}" data-fid="${esc(f.id)}">在热力图上定位</button>
      <a class="btn btn--tiny" href="${studentUrl(f.t0)}">去学生端看这段</a>
    </div>
  </article>`;
}

function renderInsight(): string {
  const r = report!;
  if (!r.verdict) return '';
  const plan = (r.plan ?? []).map((p, i) => `<li><span class="pn">${i + 1}</span>${esc(p)}</li>`).join('');
  const lowSample = r.reliability.level !== 'ok'
    ? `<div class="notice">${esc(r.reliability.reason)}</div>`
    : '';
  return `<section class="panel panel--insight">
    <div class="panelHead">
      <h2>复盘结论</h2>
      <span class="tag">${r.engine.narrative === 'offline-model' ? '离线模型' : '规则生成'}</span>
    </div>
    <p class="verdict">${esc(r.verdict)}</p>
    ${lowSample}
    ${plan ? `<div class="planT" style="font-size:11px;color:var(--ink-3);margin:12px 0 8px;">下一步</div><ol class="plan" style="margin:0;padding-left:18px;font-size:12.3px;line-height:1.75;color:var(--ink-2)">${plan}</ol>` : ''}
  </section>`;
}

/** 匿名观众 ID → 「学生 N」，列表里只显示这个 */
const viewerLabel = (id: string): string => viewerLabels.get(id) ?? '学生';

function renderCard(c: MemoryCard): string {
  const sub = c.note ? `<div class="mSub">${esc(c.note)}</div>` : '';
  return `<article class="mcard" style="border-left-color:${TYPE_COLOR[c.type]}">
    <div class="mHead">
      <span class="mTime">${fmtTime(c.t)}</span>
      <span class="mType" style="color:${TYPE_COLOR[c.type]};background:${TYPE_COLOR[c.type]}14">${TYPE_LABEL[c.type]}</span>
      <span class="mViewer">${esc(viewerLabel(c.viewer))}</span>
    </div>
    <div class="mQuote">${esc(c.quote)}</div>
    ${sub}
  </article>`;
}

function renderCards(): string {
  const r = report!;
  const all = cardFile?.cards ?? [];
  const list = (sel ? all.filter((c) => c.t >= sel!.t0 && c.t < sel!.t1) : all)
    .slice()
    .sort((a, b) => a.t - b.t);
  const head = sel
    ? `<div class="panelHead"><h2>学生秒记</h2><span class="panelHint">${esc(sel.label)} · ${list.length} 张</span>
       <button class="btn btn--tiny" data-clear="1">看全部 ${all.length} 张</button></div>`
    : `<div class="panelHead"><h2>学生秒记</h2><span class="panelHint">共 ${list.length} 张 · 按视频时间排序 · 点热力格可筛选</span></div>`;
  const body = list.length
    ? `<div class="cards">${list.map(renderCard).join('')}</div>`
    : `<p class="empty">这段区间还没有秒记</p>`;

  const cnt = r.scale.byType;
  const legend = (['question', 'fix', 'step', 'key', 'case'] as CardType[])
    .filter((t) => (cnt[t] ?? 0) > 0)
    .map((t) => `<span class="lgItem"><i class="lgDot" style="background:${TYPE_COLOR[t]}"></i>${TYPE_LABEL[t]} ${cnt[t]}</span>`)
    .join('');

  return `<section class="panel">
    ${head}
    <div class="legend">${legend || '<span class="panelHint">还没有任何秒记</span>'}</div>
    ${body}
  </section>`;
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
  const minutes = Math.round(r.scale.durationSec / 60);

  APP!.innerHTML = `
  <div class="app">
    <header class="topbar">
      <div class="brandRow">
        <span class="brandMark" aria-hidden="true"></span>
        <span class="brandName">ReLive</span>
        <span class="brandSub">秒记卡 · 教师端工作台</span>
      </div>
      <div class="topRight">
        ${renderChips()}
        <a class="btn btn--primary" href="${studentUrl(0)}">回到学生点播</a>
      </div>
    </header>

    <div class="shell">
      ${renderNav()}

      <main class="work">
        <section class="head">
          <div class="eyebrow">ON-DEMAND COURSE REVIEW</div>
          <h1 class="headTitle">${esc(r.title || r.sessionId)}</h1>
          <div class="headMeta">
            <span class="mono">${esc(r.videoKey || r.sessionId)}</span>
            <span>${minutes} 分钟</span>
            <span>${r.scale.cards} 张秒记</span>
            <span>${r.scale.viewers} 位学生</span>
          </div>
        </section>

        ${renderStats()}

        <section class="panel">
          <div class="panelHead">
            <h2>学生标记热力图</h2>
            <span class="panelHint">纵向为秒记类型，颜色越深表示标记越多 · 点任意格子可筛选</span>
          </div>
          <div class="heatwrap" id="heat">${svg}</div>
        </section>

        ${renderCards()}

        <p class="footer">
          数据来源：学生端「记一下」实时上报 <code>POST /api/notes</code> ·
          聚合 <code>GET /api/teacher/&lt;videoKey&gt;</code> ·
          每 ${LIVE_POLL_MS / 1000} 秒自动刷新
        </p>
      </main>

      <aside class="rail">
        ${renderInsight()}
        <section class="panel">
          <div class="panelHead">
            <h2>值得注意的段落</h2>
            <span class="panelHint">${r.findings.length} 条 · ${highN} 条建议处理</span>
          </div>
          <div class="findings">${findings || '<p class="empty">还没有足够的秒记来形成结论</p>'}</div>
        </section>
        ${renderDist()}
      </aside>
    </div>
  </div>`;

  // 侧栏列表很长，把当前选中的那条滚到可见位置
  const active = APP!.querySelector('.nItem.is-active');
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
