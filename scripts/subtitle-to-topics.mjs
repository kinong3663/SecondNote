/**
 * ReLive · 字幕 → 话题分段（把 ASR/智能字幕变成"三线"里的讲师话题线）
 *
 * 输入：public/data/raw/subtitle.srt（或 .vtt；保利威智能字幕通常给 SRT）
 * 输出：public/data/topics.json  { meta, segments:[{id,startSec,endSec,topic,text,cues}] }
 *
 * 分段策略（可解释，不用大模型）：
 *   1. 先按"停顿"切块：相邻 cue 间隔 > PAUSE_SEC 视为一次自然停歇
 *   2. 再按"时长"合并：块太短（< MIN_MIN）就并到前一块，太长（> MAX_MIN）就在内部停顿最久处再切
 *   3. 每块标题 = 该块高频词 + 首句关键短语（纯统计，不用 LLM）
 *
 * 用法：node scripts/subtitle-to-topics.mjs
 *      node scripts/subtitle-to-topics.mjs --file public/data/raw/subtitle.srt --max 12
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const FILE = path.resolve(arg('file', 'public/data/raw/subtitle.srt'));
const OUT = path.resolve(arg('out', 'public/data/topics.json'));
const PAUSE_SEC = Number(arg('pause', 25));   // 停顿阈值（秒）
const MIN_MIN = Number(arg('min', 4));        // 段最短（分钟）
const MAX_MIN = Number(arg('max', 14));       // 段最长（分钟）

if (!fs.existsSync(FILE)) { console.error('找不到字幕文件：' + FILE); process.exit(2); }
let raw = fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, '');

// ---- 解析 SRT / VTT（与 SDK 的 parseAISubtitleContent 等价，且修掉多行拼接问题）----
function parse(text) {
  const cues = [];
  const blocks = text.replace(/\r\n/g, '\n').replace(/^WEBVTT.*$/m, '').split(/\n{2,}/);
  const reTS = /^((?:\d{1,}:)?\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*((?:\d{1,}:)?\d{2}:\d{2}[,.]\d{1,3})/;
  const toMs = (t) => {
    const m = t.match(/^(?:(\d{1,}):)?(\d{2}):(\d{2})[,.](\d{1,3})$/);
    if (!m) return null;
    return (+(m[1] ?? 0)) * 3600000 + (+m[2]) * 60000 + (+m[3]) * 1000 + (+m[4].padEnd(3, '0'));
  };
  for (const b of blocks) {
    const lines = b.split('\n').filter(Boolean);
    if (!lines.length) continue;
    const tsIdx = lines.findIndex((l) => reTS.test(l.trim()));
    if (tsIdx < 0) continue;
    const m = lines[tsIdx].trim().match(reTS);
    const start = toMs(m[1]), end = toMs(m[2]);
    if (start == null || end == null) continue;
    const text = lines.slice(tsIdx + 1).join(' ').replace(/<[^>]+>/g, '').trim(); // 多行用空格拼，剥标签
    if (text) cues.push({ start, end, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}

const cues = parse(raw);
if (!cues.length) { console.error('没解析出字幕条目，检查文件格式'); process.exit(1); }
const durationSec = Math.round(cues.at(-1).end / 1000);
console.log(`字幕 ${cues.length} 条 · 总时长 ${Math.floor(durationSec / 60)} 分钟`);

// ---- 1) 按停顿切块 ----
const chunks = [];
let cur = [cues[0]];
for (let i = 1; i < cues.length; i++) {
  const gap = (cues[i].start - cues[i - 1].end) / 1000;
  if (gap > PAUSE_SEC) { chunks.push(cur); cur = []; }
  cur.push(cues[i]);
}
chunks.push(cur);
console.log(`按停顿(>${PAUSE_SEC}s)切成 ${chunks.length} 块`);

// ---- 2) 按时长合并/再切（递归切，保证每段 ≤ MAX_MIN）----
const dur = (c) => (c.at(-1).end - c[0].start) / 1000;
const MAX = MAX_MIN * 60;
/** 在内部最长的停顿处一分为二，递归直到 ≤ MAX */
function splitToMax(c) {
  if (dur(c) <= MAX || c.length < 4) return [c];
  let bestIdx = Math.floor(c.length / 2), bestGap = -1;
  for (let i = 2; i < c.length - 2; i++) {
    const g = c[i].start - c[i - 1].end;
    if (g > bestGap) { bestGap = g; bestIdx = i; }
  }
  return [...splitToMax(c.slice(0, bestIdx)), ...splitToMax(c.slice(bestIdx))];
}

const merged = [];
for (const c of chunks) {
  if (merged.length && dur(c) < MIN_MIN * 60) {
    const sum = (dur(merged.at(-1)) + dur(c)) / 60;
    if (sum <= MAX_MIN) { merged[merged.length - 1] = [...merged.at(-1), ...c]; continue; }
  }
  merged.push(...splitToMax(c));
}
// 最终保障：合并可能跨过长静默把 span 拉大，这里再强制切一遍，保证不变量「每段 ≤ MAX」
for (let i = 0; i < merged.length; i++) {
  let guard = 0;
  while (dur(merged[i]) > MAX && merged[i].length >= 4 && guard++ < 20) {
    const c = merged[i];
    let bi = Math.floor(c.length / 2), bg = -1;
    for (let k = 2; k < c.length - 2; k++) {
      const g = c[k].start - c[k - 1].end;
      if (g > bg) { bg = g; bi = k; }
    }
    merged.splice(i, 1, c.slice(0, bi), c.slice(bi));
  }
}
console.log(`合并/切分后 ${merged.length} 段（每段 ≤ ${MAX_MIN} 分钟）`);

// ---- 3) 每段起标题 ----
// 中文没有空格，直接切 n-gram 会跨越词边界（出现"大家好今天我"这种垃圾）。
// 所以用「领域词表命中 + 首句」两段式：命中词做标签，首句做可读标题。
const LEXICON = ['复盘','直播','回放','字幕','逐字稿','弹幕','互动','观众','人数','留存','曲线','数据','接口','统计','分析','接口','汇总','产品','功能','演示','案例','客户','价格','套餐','服务','交付','培训','课程','讲师','答疑','提问','签到','答题','抽奖','问卷','公告','权限','账号','频道','配置','部署','测试','上线','问题','方案','流程','步骤','效果','指标','转化','预算','采购','试用'];
function titleOf(segCues) {
  const text = segCues.map((c) => c.text).join('');
  const tags = LEXICON.filter((w) => text.includes(w))
    .map((w) => ({ w, n: (text.match(new RegExp(w, 'g')) ?? []).length }))
    .filter((x) => x.n >= 2)
    .sort((a, b) => b.n - a.n)
    .slice(0, 2)
    .map((x) => x.w);
  // 代表句：不取第一句（常是"喂喂喂/有声音吗"这类开场噪声），
  // 而是取"领域词命中最多、且长度够"的那一句
  const score = (c) => LEXICON.reduce((n, w) => n + (c.text.includes(w) ? 1 : 0), 0) * 10 + Math.min(c.text.length, 20);
  const rep = [...segCues].sort((a, b) => score(b) - score(a))[0] ?? segCues[0];
  const head = rep.text.replace(/[，。、？!,.?…]/g, '').slice(0, 20);
  return tags.length ? `${tags.join(' / ')}｜${head}` : head;
}

const segments = merged.map((c, i) => {
  const startSec = Math.round(c[0].start / 1000);
  const endSec = Math.round(c.at(-1).end / 1000);
  return {
    id: `a${i + 1}`,
    startSec, endSec,
    minutes: Number(((endSec - startSec) / 60).toFixed(1)),
    topic: titleOf(c),
    text: c.map((x) => x.text).join(''),
    cues: c.length,
  };
});

const out = {
  meta: { source: path.basename(FILE), cues: cues.length, durationSec, segments: segments.length, generatedAt: new Date().toISOString(), method: 'pause+merge+tf-title' },
  segments,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');

const mmss = (s) => `${Math.floor(s / 60)}'${String(s % 60).padStart(2, '0')}"`;
console.log(`\n✅ ${OUT}`);
for (const s of segments) console.log(`  ${mmss(s.startSec).padStart(7)}-${mmss(s.endSec).padEnd(8)} ${String(s.minutes).padStart(5)}min  ${s.cues} cues  ${s.topic}`);
