/**
 * ReLive · 内容体检（只靠字幕就能出的复盘章节，100% 真实数据）
 *
 * 输入：public/data/topics.json（由 subtitle-to-topics.mjs 从智能字幕生成）
 *      public/data/raw/subtitle.srt（原始 cue，用于算停顿与静音）
 * 输出：public/data/review/content-audit-<vid>.md  +  .json
 *
 * 为什么单独做这一层：
 *   人数曲线、弹幕、互动在最坏的账号上全都拿不到，但"讲了什么、讲了多久、有没有互动、
 *   哪里是设备调试"这些只靠字幕就能算——这是任何企业直播都拿得到的复盘下限。
 *
 * 用法：node scripts/content-audit.mjs --vid bfcb278e7a88e2d51e23ba453596ddf2_b
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const VID = arg('vid', 'bfcb278e7a88e2d51e23ba453596ddf2_b');
const TOPICS = path.resolve('public/data/topics.json');
const SRT = path.resolve('public/data/raw/subtitle.srt');
const OUTDIR = path.resolve('public/data/review');

if (!fs.existsSync(TOPICS)) { console.error('缺 topics.json，先跑 subtitle-to-topics.mjs'); process.exit(2); }
const topics = JSON.parse(fs.readFileSync(TOPICS, 'utf8'));

const mmss = (s) => `${Math.floor(s / 60)}'${String(Math.round(s % 60)).padStart(2, '0')}"`;
const HOOK_RE = /[？?]|扣\s*个?\s*1|打在公屏|公屏上|试一下|试一试|注意看|看这里|有没有|谁来|大家看|举手|签到|投票/;
const FILLER_RE = /^(嗯|啊|喂|哦|额|那个|就是)+[。，]?$/;

// ---- 解析 SRT 拿 cue 级时间（算停顿/静音必须用 cue，而不是分段后的文本） ----
function parseSrt(text) {
  const cues = [];
  const blocks = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split(/\n{2,}/);
  const re = /^((?:\d{1,}:)?\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*((?:\d{1,}:)?\d{2}:\d{2}[,.]\d{1,3})/;
  const toMs = (t) => { const m = t.match(/^(?:(\d{1,}:))?(\d{2}):(\d{2})[,.](\d{1,3})$/); return m ? (+(m[1]?.slice(0, -1) ?? 0)) * 3600000 + (+m[2]) * 60000 + (+m[3]) * 1000 + +m[4].padEnd(3, '0') : null; };
  for (const b of blocks) {
    const lines = b.split('\n').filter(Boolean);
    const i = lines.findIndex((l) => re.test(l.trim()));
    if (i < 0) continue;
    const m = lines[i].trim().match(re);
    const s = toMs(m[1]), e = toMs(m[2]);
    const t = lines.slice(i + 1).join('').replace(/<[^>]+>/g, '').trim();
    if (s != null && e != null && t) cues.push({ start: s, end: e, text: t });
  }
  return cues.sort((a, b) => a.start - b.start);
}

const cues = fs.existsSync(SRT) ? parseSrt(fs.readFileSync(SRT, 'utf8')) : [];
const charsOf = (s) => (s.match(/[\u4e00-\u9fa5]|[a-zA-Z0-9]/g) ?? []).length;
const durationSec = topics.meta.durationSec;

// ---- 全场体检 ----
const totalChars = cues.reduce((n, c) => n + charsOf(c.text), 0);
const gaps = cues.slice(1).map((c, i) => (c.start - cues[i].end) / 1000).filter((g) => g > 0);
const silentSec = gaps.filter((g) => g > 2).reduce((a, b) => a + b, 0);
const longestSilence = gaps.length ? Math.max(...gaps) : 0;
const fillerCount = cues.filter((c) => FILLER_RE.test(c.text.replace(/\s/g, ''))).length;
// 开场噪声：前 15 分钟内出现"有声音吗/听得到吗/喂喂"
const warmupLast = cues.filter((c) => c.start < 15 * 60000 && /有声音|听得到|听得见|喂喂|信号|卡吗|能看到/.test(c.text)).at(-1);

// ---- 分段体检 ----
const segs = topics.segments.map((s) => {
  const inSeg = cues.filter((c) => c.start / 1000 >= s.startSec && c.start / 1000 < s.endSec);
  const chars = inSeg.reduce((n, c) => n + charsOf(c.text), 0);
  const minutes = (s.endSec - s.startSec) / 60;
  const cpm = chars / Math.max(0.1, minutes);
  const hooks = (s.text.match(HOOK_RE) ?? []).length;
  const segGaps = inSeg.slice(1).map((c, i) => (c.start - inSeg[i].end) / 1000).filter((g) => g > 2);
  return {
    ...s,
    chars, cpm: Number(cpm.toFixed(1)), hooks,
    silenceSec: Math.round(segGaps.reduce((a, b) => a + b, 0)),
    longestGap: segGaps.length ? Math.round(Math.max(...segGaps)) : 0,
    risk: (minutes >= 8 && hooks === 0) ? 'high' : (minutes >= 6 && hooks <= 1) ? 'medium' : 'low',
  };
});

const risks = segs.filter((s) => s.risk !== 'low').sort((a, b) => (b.risk === 'high') - (a.risk === 'high') || b.minutes - a.minutes);
const best = [...segs].sort((a, b) => b.hooks / (b.minutes || 1) - a.hooks / (a.minutes || 1))[0];

// ---- 输出 ----
const report = {
  meta: { vid: VID, source: 'smart-subtitle (polyv /vod/v4)', durationSec, cues: cues.length, segments: segs.length, generatedAt: new Date().toISOString() },
  kpi: {
    minutes: Math.round(durationSec / 60),
    chars: totalChars,
    cpm: Number((totalChars / (durationSec / 60)).toFixed(1)),
    silenceRatio: Number((silentSec / durationSec).toFixed(3)),
    longestSilence: Math.round(longestSilence),
    fillerCount,
    warmupMin: warmupLast ? Number((warmupLast.start / 60000).toFixed(1)) : 0,
    hookTotal: segs.reduce((n, s) => n + s.hooks, 0),
    riskSegments: risks.length,
  },
  segments: segs,
  risks,
  best: best ? { topic: best.topic, startSec: best.startSec, hooks: best.hooks, minutes: best.minutes } : null,
};

fs.mkdirSync(OUTDIR, { recursive: true });
fs.writeFileSync(path.join(OUTDIR, `content-audit-${VID}.json`), JSON.stringify(report, null, 2), 'utf8');

const L = [];
L.push(`# 内容体检 · 智能字幕版`, '');
L.push(`> vid \`${VID}\` · ${report.kpi.minutes} 分钟 · ${cues.length} 条字幕 · 数据来源：保利威点播智能字幕（真实 ASR）`, '');
L.push('## 1. 一眼结论', '');
L.push(`- 全场口播 **${totalChars.toLocaleString()} 字**，平均 **${report.kpi.cpm} 字/分钟**（中文舒适区 4~5.5 字/秒 ≈ 240~330 字/分钟）`);
L.push(`- 静音占比 **${(report.kpi.silenceRatio * 100).toFixed(1)}%**，最长一次停顿 **${report.kpi.longestSilence} 秒**`);
L.push(`- 互动钩子共 **${report.kpi.hookTotal} 处**，**${risks.length} 段**存在"长段无互动"风险`);
if (warmupLast) L.push(`- 开场前 **${report.kpi.warmupMin} 分钟**还在调设备（出现"有声音吗/听得到吗"类台词）`);
L.push('');

L.push('## 2. 分段体检', '');
L.push('| 时间 | 时长 | 字数 | 字/分钟 | 互动钩子 | 静音 | 风险 |');
L.push('|---|---|---|---|---|---|---|');
for (const s of segs) {
  L.push(`| ${mmss(s.startSec)}-${mmss(s.endSec)} | ${s.minutes.toFixed(1)}min | ${s.chars} | ${s.cpm} | ${s.hooks} | ${s.silenceSec}s | ${s.risk === 'high' ? '🔴 高' : s.risk === 'medium' ? '🟡 中' : '—'} |`);
}
L.push('');

L.push('## 3. 风险段与改法', '');
if (!risks.length) L.push('没有长段无互动的风险段。');
for (const s of risks.slice(0, 6)) {
  L.push(`### ${mmss(s.startSec)}-${mmss(s.endSec)}（${s.minutes.toFixed(1)} 分钟，钩子 ${s.hooks} 处）`);
  L.push(`- **现象**：连续 ${s.minutes.toFixed(1)} 分钟讲解，${s.hooks} 处互动钩子，静音 ${s.silenceSec} 秒`);
  L.push(`- **归因**：单口讲解过长（这段内容：「${s.topic}」）`);
  L.push(`- **改法**：在此段 1/2 处插一句提问，把段落拆成两段；或在该段开头预告「这段 5 分钟，讲完我们做个投票」`);
  L.push(`- **依据**：复盘规则「段长 ≥ 8 分钟且钩子 = 0 → 高流失风险」`);
  L.push('');
}

L.push('## 4. 高光段（可切片复用）', '');
if (report.best) L.push(`「${report.best.topic}」（${mmss(report.best.startSec)} 起，${report.best.minutes.toFixed(1)} 分钟，钩子 ${report.best.hooks} 处）—— 互动密度最高，适合剪成 30~60 秒切片做下一场开场。`);
L.push('');

L.push('## 5. 数据口径', '');
L.push(`- **话题分段**：停顿切块（>25s）+ 时长合并/切分（每段 ≤12 分钟），标题 = 领域词命中 + 代表句`);
L.push(`- **字幕来源**：保利威点播智能字幕任务（\`POST /vod/v4/smart-subtitle/create\`，taskId 可查），真实 ASR 结果`);
L.push(`- **字/分钟只做相对比较**：ASR 会吞字，实操型直播还有大段静默（本场静音 ${(report.kpi.silenceRatio * 100).toFixed(0)}%），所以 ${report.kpi.cpm} 字/分钟不代表语速慢，只代表"口播密度低"`);
L.push(`- **缺口**：本频道无分钟级并发、无弹幕；因此本报告不含"人数线"与"弹幕线"，只做内容体检`);
L.push('');
L.push('---');
L.push(`_ReLive 内容体检 · ${report.meta.generatedAt}_`);

fs.writeFileSync(path.join(OUTDIR, `content-audit-${VID}.md`), L.join('\n'), 'utf8');

console.log(`✅ public/data/review/content-audit-${VID}.md`);
console.log(`   ${report.kpi.minutes} 分钟 · ${cues.length} cue · ${totalChars} 字 · ${report.kpi.cpm} 字/分钟 · 静音 ${(report.kpi.silenceRatio * 100).toFixed(1)}%`);
console.log(`   风险段 ${risks.length} 个，最高危：${risks[0] ? mmss(risks[0].startSec) + ' (' + risks[0].minutes.toFixed(1) + 'min, 钩子 ' + risks[0].hooks + ')' : '无'}`);
