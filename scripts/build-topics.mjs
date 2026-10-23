/**
 * 从「直播录制文件」抽内容线（完全在直播侧，不碰点播观看数据）
 *
 * 输入：public/data/raw/record-file-list.json   录制文件列表（含 channelSessionId / subtitleList / outline）
 *      public/data/raw/srt/<sessionId>.srt     现成 SRT 字幕
 *      public/data/raw/outlines/<fileId>.json  官方 AI 大纲（outlineContent）
 * 输出：public/data/derived/topics/<sessionId>.json   话题章节（标题来自官方大纲，正文按 cue 索引切）
 *      public/data/derived/alignments.json           录制文件↔场次 的对齐证据
 *      public/data/derived/interactions-schema.json  互动事件格式（供后续模拟数据注入）
 *
 * 关键：官方大纲的 startIndex / endIndex 指向字幕条目序号 → 章节与逐字稿天然绑定。
 * 用法：node scripts/build-topics.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const RAW = path.join(ROOT, 'public', 'data', 'raw');
const OUT = path.join(ROOT, 'public', 'data', 'derived');
for (const d of ['topics']) fs.mkdirSync(path.join(OUT, d), { recursive: true });

const readJson = (p, fb = null) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fb);
const writeJson = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 1), 'utf8');

// ---------- SRT 解析（与 SDK parseAISubtitleContent 等价，但多行用空格拼、剥标签）----------
function parseSrt(text) {
  const cues = [];
  const blocks = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split(/\n{2,}/);
  const re = /^((?:\d{1,}:)?\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*((?:\d{1,}:)?\d{2}:\d{2}[,.]\d{1,3})/;
  const toSec = (t) => {
    const m = t.match(/^(?:(\d{1,}):)?(\d{2}):(\d{2})[,.](\d{1,3})$/);
    if (!m) return null;
    return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
  };
  for (const b of blocks) {
    const lines = b.split('\n').filter(Boolean);
    const i = lines.findIndex((l) => re.test(l.trim()));
    if (i < 0) continue;
    const m = lines[i].trim().match(re);
    const start = toSec(m[1]);
    const end = toSec(m[2]);
    const text = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (start != null && end != null && text) cues.push({ start, end, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}

const parseHms = (s) => {
  // 注意：小时组要带上它自己的冒号，否则 "00:25:13,040" 这种三段式解析不出来
  const m = String(s).match(/^(?:(\d{1,}):)?(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
};

// ---------- 录制文件 ↔ 场次 对齐 ----------
const listRaw = readJson(path.join(RAW, 'record-file-list.json'), { contents: [] });
const files = Array.isArray(listRaw) ? listRaw : (listRaw.contents ?? []);
const sessions = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'contract', 'sessions.json'), 'utf8')).sessions;

const parseYmdHms = (s) => {
  const y = +s.slice(0, 4), mo = +s.slice(4, 6), d = +s.slice(6, 8), h = +s.slice(8, 10), mi = +s.slice(10, 12), se = +s.slice(12, 14);
  return Date.UTC(y, mo - 1, d, h - 8, mi, se);
};

const alignments = {};
for (const f of files) {
  const s = sessions.find((x) => x.sessionId === f.channelSessionId);
  if (!s) continue;
  const recStart = parseYmdHms(f.startTime);
  const offsetSec = Math.round((recStart - s.startTime) / 1000);
  const recDur = (parseYmdHms(f.endTime) - recStart) / 1000;
  const sesDur = (s.endTime - s.startTime) / 1000;
  const durationDeltaSec = Math.round(recDur - sesDur);
  const grade = Math.abs(offsetSec) <= 5 && Math.abs(durationDeltaSec) <= 10 ? 'verified' : Math.abs(offsetSec) <= 60 ? 'weak' : 'none';
  alignments[f.channelSessionId] = {
    sessionId: f.channelSessionId,
    fileId: f.fileId,
    evidence: 'record-file.list: channelSessionId + startTime + duration',
    offsetSec,
    durationDeltaSec,
    grade,
    watchUrl: f.watchUrl?.startsWith('//') ? `https:${f.watchUrl}` : f.watchUrl,
    hasSubtitle: Boolean(f.subtitleList?.length),
    hasOutline: f.outline?.status === 'success',
    note: grade === 'verified'
      ? `录制起点比场次起点晚 ${Math.abs(offsetSec)}s，时长差 ${Math.abs(durationDeltaSec)}s → 时间轴可直接换算`
      : `偏移 ${offsetSec}s / 时长差 ${durationDeltaSec}s，对齐需人工确认`,
  };
}
writeJson(path.join(OUT, 'alignments.json'), {
  meta: { generatedAt: new Date().toISOString(), note: '直播第 N 秒 = 录制文件第 (N - offsetSec) 秒' },
  alignments,
});

// ---------- 话题章节 ----------
let built = 0;
const report = [];
for (const f of files) {
  const sid = f.channelSessionId;
  const srtPath = path.join(RAW, 'srt', `${sid}.srt`);
  const outlineDoc = readJson(path.join(RAW, 'outlines', `${f.fileId}.json`));
  const chapters = outlineDoc?.outline?.outlineContent ?? [];
  if (!chapters.length) {
    report.push({ sessionId: sid, fileId: f.fileId.slice(0, 8), chapters: 0, cues: 0, note: '无官方大纲，跳过' });
    continue;
  }
  const cues = fs.existsSync(srtPath) ? parseSrt(fs.readFileSync(srtPath, 'utf8')) : [];
  const offsetSec = alignments[sid]?.offsetSec ?? 0;

  const segments = chapters.map((c, i) => {
    const startSec = parseHms(c.startTime) ?? 0;
    const rawEnd = parseHms(c.endTime) ?? startSec;
    // 官方章节之间可能重叠（语义上是"包含"关系），保留原始区间不裁剪；
    // 只标记 overlapping，渲染时用半透明让重叠可见。
    const nextStart = i + 1 < chapters.length ? (parseHms(chapters[i + 1].startTime) ?? Infinity) : Infinity;
    const endSec = rawEnd;
    // 官方给的 startIndex/endIndex 是 1-based 的字幕条目序号
    const a = Math.max(0, Number(c.startIndex ?? 1) - 1);
    const b = Math.min(cues.length, Number(c.endIndex ?? cues.length));
    const slice = cues.slice(a, b);
    return {
      id: `c${i + 1}`,
      topic: c.title || `第 ${i + 1} 章`,
      startSec: Math.round(startSec),
      endSec: Math.round(endSec),
      rawEndSec: Math.round(rawEnd),
      overlapping: nextStart < rawEnd - 1,
      minutes: Number(((endSec - startSec) / 60).toFixed(1)),
      cues: slice.length,
      text: slice.map((x) => x.text).join(''),
      summary: Array.isArray(c.summary) ? c.summary : [],
      keyword: Array.isArray(c.keyword) ? c.keyword : [],
      // 换算到"直播开始后秒"：录制比场次晚 offsetSec 开始
      liveStartSec: Math.round(startSec - offsetSec),
      liveEndSec: Math.round(endSec - offsetSec),
    };
  });

  writeJson(path.join(OUT, 'topics', `${sid}.json`), {
    sessionId: sid,
    source: 'live-outline+asr',
    method: 'official-outline chapters × cue-slice',
    origin: `record-file(${f.fileId.slice(0, 8)}) outline + ${path.basename(srtPath)}`,
    durationSec: Math.round(f.duration ?? 0) || Math.round(cues.at(-1)?.end ?? 0),
    cues: cues.length,
    offsetSec,
    note: '章节标题与时间来自官方 AI 大纲；正文按 startIndex/endIndex 从 SRT 切出。官方章节之间可能重叠，endSec 已裁到下一章开始。',
    segments,
  });
  built++;
  report.push({ sessionId: sid, fileId: f.fileId.slice(0, 8), chapters: segments.length, cues: cues.length, minutes: segments.reduce((n, x) => n + x.minutes, 0) });
}

// ---------- 互动事件格式（只定格式，等模拟数据注入）----------
writeJson(path.join(OUT, 'interactions-schema.json'), {
  version: 1,
  note: '互动线格式。当前账号实测 0 条；后续模拟数据按此格式生成，source 标 sim 即可被引擎消费。',
  file: 'contract/interactions/<sessionId>.json',
  root: { sessionId: 'string', source: "'real' | 'sdk' | 'sim'", events: 'InteractionEvent[]' },
  event: {
    t: 'number  // 相对开播秒（与人数曲线同一根轴）',
    type: "enum: lottery | checkin | answer_card | questionnaire | like | qa | product | gift | notice | chat",
    joined: 'number?  // 参与人数',
    total: 'number?   // 可参与人数',
    result: 'object?  // 结果，如 { winnerCount, prize } / { correctRate }',
    payload: 'object?  // 原始字段，供 UI 展示',
    source: "'real' | 'sdk' | 'sim'",
  },
  example: {
    sessionId: 'hcvi46hzlg',
    source: 'sim',
    events: [
      { t: 420, type: 'checkin', joined: 31, total: 41, source: 'sim' },
      { t: 1513, type: 'answer_card', joined: 28, total: 40, result: { correctRate: 0.46 }, source: 'sim' },
      { t: 2600, type: 'lottery', joined: 35, total: 38, result: { winnerCount: 5, prize: '定制周边' }, source: 'sim' },
    ],
  },
});

console.log('\n对齐证据：');
for (const [sid, a] of Object.entries(alignments)) console.log(`  ${sid}  offset ${a.offsetSec}s  时长差 ${a.durationDeltaSec}s  ${a.grade}  字幕 ${a.hasSubtitle ? '有' : '无'}`);
console.log('\n话题章节：');
for (const r of report) console.log(`  ${r.sessionId}  章节 ${r.chapters}  字幕 ${r.cues}  ${r.minutes ?? '-'}min  ${r.note ?? ''}`);
console.log(`\n✅ 产出 ${built} 份话题 → public/data/derived/topics/`);
