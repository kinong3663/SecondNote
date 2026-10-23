/**
 * 归一化：原始返回 + 派生内容 → 数据契约（直播为主）
 *
 * 输入：
 *   public/data/raw/session-summary.json    17 场统计（服务端 API）
 *   public/data/raw/curve-<day>.json        分钟级曲线（单日 concurrence）
 *   public/data/raw/playback-list.json      6 条回放
 *   public/data/derived/topics/<sid>.json   官方大纲 × SRT 章节（build-topics.mjs 产出）
 *   public/data/derived/alignments.json     录制文件↔场次 对齐证据
 *   public/data/derived/interactions-schema.json  互动事件格式
 * 输出：public/data/contract/*（4 张表 + 回放表 + 对齐表）
 *
 * 用法：node scripts/normalize.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const RAW = path.join(ROOT, 'public', 'data', 'raw');
const DER = path.join(ROOT, 'public', 'data', 'derived');
const OUT = path.join(ROOT, 'public', 'data', 'contract');
for (const d of ['curves', 'topics', 'interactions']) fs.mkdirSync(path.join(OUT, d), { recursive: true });

const readJson = (p, fb = null) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fb);
const writeJson = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 1), 'utf8');
const day = (ms) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);
const round = (v, n = 3) => Number(v.toFixed(n));

// ---------- 1. 场次 ----------
const summary = readJson(path.join(RAW, 'session-summary.json'), { contents: [] });
const rows = Array.isArray(summary) ? summary : (summary.contents ?? []);
const playbacks = readJson(path.join(RAW, 'playback-list.json'), { data: [] });
const videos = (Array.isArray(playbacks) ? playbacks[0]?.videoList : playbacks?.data?.[0]?.videoList) ?? [];
const alignments = readJson(path.join(DER, 'alignments.json'))?.alignments ?? {};

const sessions = rows.map((r) => {
  const durationMin = Math.round((r.endTime - r.startTime) / 60000);
  const rate = r.attendanceExpected ? round(r.attendanceActual / r.attendanceExpected) : null;
  const d = day(r.startTime);
  return {
    sessionId: r.sessionId,
    kind: 'live',
    title: r.name || '未命名场次',
    startTime: r.startTime,
    endTime: r.endTime,
    durationMin,
    day: d,
    uniqueViewer: r.uniqueViewer ?? 0,
    maxConcurrency: r.maxConcurrencyCount ?? 0,
    playCount: r.playCount ?? 0,
    avgPlayDurationMin: r.averagePlayDuration ?? 0,
    attendance: r.attendanceExpected ? { expected: r.attendanceExpected, actual: r.attendanceActual, rate } : null,
    videoId: null,
    watchUrl: alignments[r.sessionId]?.watchUrl ?? null,
    hasCurve: false,
    hasTopics: false,
    alignment: alignments[r.sessionId] ?? null,
    source: 'real',
  };
}).sort((a, b) => b.startTime - a.startTime);

// ---------- 2. 曲线（按天取，按场次窗口切片并重基到 t=0）----------
let curveCount = 0;
for (const s of sessions) {
  const curve = readJson(path.join(RAW, `curve-${s.day}.json`));
  if (!curve?.series?.length) continue;
  const baseMs = Date.parse(`${curve.day}T${curve.base}:00+08:00`);
  const offsetSec = Math.round((s.startTime - baseMs) / 1000);
  const endSec = offsetSec + s.durationMin * 60;
  const sliced = curve.series.filter((p) => p.t * 60 >= offsetSec && p.t * 60 <= endSec + 60);
  if (sliced.length < 3) continue;
  writeJson(path.join(OUT, 'curves', `${s.sessionId}.json`), {
    sessionId: s.sessionId,
    kind: 'live-minute',
    bucketSec: 60,
    source: 'real',
    origin: `concurrence(${curve.day} ${curve.base}) + offset ${offsetSec}s`,
    points: sliced.map((p) => ({ t: Math.round(p.t * 60 - offsetSec), v: Math.max(0, Math.round(p.viewers)) })),
  });
  s.hasCurve = true;
  curveCount++;
}

// ---------- 3. 话题（官方大纲 + SRT，来自 derived）----------
let topicCount = 0;
for (const s of sessions) {
  const t = readJson(path.join(DER, 'topics', `${s.sessionId}.json`));
  if (!t?.segments?.length) continue;
  writeJson(path.join(OUT, 'topics', `${s.sessionId}.json`), t);
  s.hasTopics = true;
  topicCount++;
}

// ---------- 4. 互动（真实 0 条，格式已定义，等待注入模拟数据）----------
const schema = readJson(path.join(DER, 'interactions-schema.json'));
for (const s of sessions) {
  writeJson(path.join(OUT, 'interactions', `${s.sessionId}.json`), {
    sessionId: s.sessionId,
    source: 'real',
    note: '本账号实测互动记录为 0 条（未发起过抽奖/签到/答题等）。格式见 interactions/_schema.json，后续模拟数据按同格式注入并标 source=sim。',
    events: [],
  });
}
if (schema) writeJson(path.join(OUT, 'interactions', '_schema.json'), schema);

// ---------- 5. 回放表（6 条回放 + 1 条点播）----------
const parseDur = (s) => {
  const [h, m, sec] = String(s).split(':').map(Number);
  return h * 3600 + m * 60 + sec;
};
const normTitle = (s) => s.replace(/\s/g, '');

const replays = videos.map((v) => {
  const durationSec = parseDur(v.duration);
  // 回放 ↔ 场次没有外键：先看录制文件映射（fileId 命中），再退回"时长±60s + 候选唯一"
  const byFile = Object.values(alignments).find((a) => a.fileId === v.videoId);
  let bound = byFile ? sessions.find((s) => s.sessionId === byFile.sessionId) ?? null : null;
  let matchedBy = byFile ? 'record-file.fileId' : null;
  if (!bound) {
    const cands = sessions.filter((s) => s.kind === 'live' && Math.abs(s.durationMin * 60 - durationSec) <= 60);
    if (cands.length === 1) { bound = cands[0]; matchedBy = 'duration±60s(unique)'; }
  }
  return {
    videoId: v.videoId,
    title: v.name,
    durationSec,
    durationMin: Math.round(durationSec / 60),
    watchUrl: v.watchUrl?.startsWith('//') ? `https:${v.watchUrl}` : v.watchUrl,
    kind: 'live-replay',
    sessionId: bound?.sessionId ?? null,
    matchedBy,
    bindNote: bound
      ? null
      : `无 fileId 命中，且没有唯一时长匹配的场次（相近 ${sessions.filter((s) => Math.abs(s.durationMin * 60 - durationSec) <= 60).length} 个），留空不猜`,
    hasTopics: bound?.hasTopics ?? false,
    hasCurve: bound?.hasCurve ?? false,
  };
});
replays.unshift({
  videoId: 'bfcb278e7a88e2d51e23ba453596ddf2_b',
  title: 'AI数字人共创社 · 点播原片（190 分钟）',
  durationSec: 11423,
  durationMin: 190,
  watchUrl: 'https://live.polyv.cn/watch/4711207',
  kind: 'vod',
  sessionId: null,
  matchedBy: null,
  bindNote: '点播库独立视频，非直播场次产物，无法绑定',
  hasTopics: false,
  hasCurve: false,
});
writeJson(path.join(OUT, 'replays.json'), {
  meta: {
    generatedAt: new Date().toISOString(),
    source: 'real',
    total: replays.length,
    note: '回放来自 /live/v4/channel/playback/list（6 条）+ 点播 1 条。绑定优先级：record-file.fileId 命中 > 时长±60s 且唯一 > 留空。',
  },
  replays,
});

// ---------- 6. 对齐表 + 主表 ----------
writeJson(path.join(OUT, 'alignments.json'), {
  meta: { generatedAt: new Date().toISOString(), note: '直播第 N 秒 = 录制文件第 (N - offsetSec) 秒' },
  alignments,
});
writeJson(path.join(OUT, 'sessions.json'), {
  meta: {
    channelId: '4711207',
    generatedAt: new Date().toISOString(),
    source: 'real',
    note: '场次≠回放：场次来自 session/list（含测试短场），回放来自视频库。内容线来自「录制文件」的官方大纲 + SRT，与场次通过 channelSessionId 绑定且时间轴已验证。',
    counts: {
      liveSessions: sessions.filter((s) => s.kind === 'live').length,
      vodItems: 0,
      playbacks: videos.length,
      withCurve: sessions.filter((s) => s.hasCurve).length,
      withTopics: sessions.filter((s) => s.hasTopics).length,
      verifiedAlignment: Object.values(alignments).filter((a) => a.grade === 'verified').length,
    },
  },
  sessions,
});
writeJson(path.join(OUT, 'index.json'), {
  generatedAt: new Date().toISOString(),
  counts: {
    sessions: sessions.length,
    curves: curveCount,
    topics: topicCount,
    interactions: 0,
    replays: replays.length,
  },
});

const withTopics = sessions.filter((s) => s.hasTopics);
console.log(`✅ 契约 → public/data/contract/`);
console.log(`   场次 ${sessions.length} · 曲线 ${curveCount} · 话题 ${topicCount} · 互动 0 · 回放 ${replays.length}`);
console.log(`   有内容的场次：${withTopics.map((s) => s.sessionId).join(', ')}`);
console.log(`   对齐已验证：${Object.values(alignments).filter((a) => a.grade === 'verified').length} 场`);
console.log(`   默认可用（曲线+话题）：${sessions.filter((s) => s.hasCurve && s.hasTopics).map((s) => s.sessionId).join(', ') || '无'}`);
