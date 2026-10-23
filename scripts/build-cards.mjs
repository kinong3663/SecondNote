/**
 * 观众端「记住卡」数据生成器 —— 教师端复盘的上游输入
 *
 * 为什么要模拟：真实观众卡片存在观众端（队友那侧），本仓库拿不到。
 * 但卡片的「位置」和「台词」不是编的：
 *   位置 ← 真实 SRT 字幕条目（cue），每张卡都钉在某一条真实字幕上
 *   台词 ← 那条字幕的原文，一个字不改
 *   章节 ← 官方 AI 大纲
 * 被模拟的只有「谁会标记、标记几张、标成什么类型」这三件事，且带 source:"sim" 标记。
 *
 * 抽样不是均匀撒点，而是按句子信息密度加权：
 *   含参数字面量 / 步骤词 / 提醒词 的句子更容易被标记 → 热点自然出现在"给参数、演示操作"的地方
 * 这样热力图才有真实形态（簇状），而不是一片均匀的噪点。
 *
 * 输入：public/data/contract/{sessions,topics}.json, public/data/raw/srt/<sid>.srt
 * 输出：public/data/contract/cards/<sid>.json + _schema.json + index.json
 * 用法：node scripts/build-cards.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CONTRACT = path.join(ROOT, 'public', 'data', 'contract');
const RAW = path.join(ROOT, 'public', 'data', 'raw');

const readJson = (p, fb = null) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fb);
const writeJson = (p, o) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(o, null, 1), 'utf8');
};

// ---------- SRT 解析（与 build-topics.mjs 同一套）----------
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

// ---------- 可复现随机（同一份输入永远产出同一份数据）----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

// ---------- 句子信息密度 ----------
const RE_STEP = /第一步|第二步|第三步|然后|接着|之后|最后|点击|选择|导入|导出|拖到|调到|设置|参数|打开|新建|添加|删掉|复制|粘贴|保存/g;
const RE_NUM = /\d{2,}|\d+\s*(?:kbps|fps|帧|像素|%|度|分钟|秒|mm|倍|个|张)/g;
const RE_WARN = /注意|容易|搞错|区别|记住|为什么|怎么|如果|但是|其实|不要|不能|建议|关键|重点/g;

function salience(text) {
  const step = (text.match(RE_STEP) ?? []).length;
  const num = (text.match(RE_NUM) ?? []).length;
  const warn = (text.match(RE_WARN) ?? []).length;
  // 底噪 1；参数与步骤最容易被"记住"；提醒词次之
  return 1 + num * 3 + step * 1.6 + warn * 1.2 + (text.length > 28 ? 0.8 : 0);
}

function pickSentence(text, max = 72) {
  const src = text.trim();
  if (src.length <= max) return src;
  const cut = src.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('，'), cut.lastIndexOf('？'), cut.lastIndexOf(' '));
  return (stop > 24 ? cut.slice(0, stop) : cut) + '…';
}

/** 单条字幕常常短到看不懂，向后并几句凑成一句能读的话（锚点仍记第一条） */
function quoteAt(cues, idx1, max = 56) {
  let s = cues[idx1 - 1].text;
  let j = idx1;
  while (s.length < 30 && j < cues.length && s.length + cues[j].text.length + 1 <= max) {
    s += ' ' + cues[j].text;
    j++;
  }
  return pickSentence(s, max);
}

const NOTES = {
  question: ['这里参数没记住', '这段没跟上', '和上一章那个参数有什么区别？', '怎么判断该加多少？', '回放要看这一段'],
  key: ['重点', '要整理进 SOP', '这个结论要背下来'],
  step: ['第 2 步漏了', '步骤顺序容易搞错', '这里得截图'],
  fix: ['讲师说的和文档不一致', '这个数值好像讲反了'],
  case: ['这个场景像我们自己的直播间', '案例可以复用'],
};

// ---------- 主流程 ----------
const sessionsFile = readJson(path.join(CONTRACT, 'sessions.json'), { sessions: [] });
const sessions = sessionsFile.sessions ?? [];
const topicsDir = path.join(CONTRACT, 'topics');

const schema = {
  $comment: '观众端「记住卡」上送格式 —— 教师端按这个格式聚合。字段名请勿改动。',
  version: 1,
  unit: {
    t: '秒，相对本条回放的播放进度（= 时间轴 0 点）',
    cue: '该卡锚定的 SRT 字幕条目序号（1 起），用于换片后重锚',
    quote: '锚定字幕原文，用于重锚校验与展示',
  },
  type: {
    key: '重点 · 想留下结论',
    question: '疑问 · 没听懂 / 需要细讲',
    step: '操作步骤 · 想照着做',
    case: '案例 · 想复用',
    fix: '疑似讲错 · 需要讲师确认',
  },
  file: {
    sessionId: 'string',
    source: 'real | sim',
    disclaimer: 'string',
    viewers: 'number 参与的独立观众数',
    cards: 'MemoryCard[]',
  },
  card: {
    id: 'string',
    t: 'number',
    cue: 'number 1-based',
    quote: 'string',
    chapterId: 'string | null',
    chapter: 'string | null',
    type: 'key | question | step | case | fix',
    viewer: 'string 匿名观众 id',
    note: 'string 可选',
    createdAt: 'ISO string',
  },
};

const index = [];
const report = [];

for (const s of sessions) {
  const sid = s.sessionId;
  const tp = path.join(topicsDir, `${sid}.json`);
  const srtPath = path.join(RAW, 'srt', `${sid}.srt`);
  if (!fs.existsSync(tp) || !fs.existsSync(srtPath)) continue;

  const topics = JSON.parse(fs.readFileSync(tp, 'utf8'));
  const cues = parseSrt(fs.readFileSync(srtPath, 'utf8'));
  if (cues.length < 3) continue;

  // 官方章节可能重叠 → 切成有效分区（每章从自己 start 到下一章 start）
  const segs = [...topics.segments].sort((a, b) => a.startSec - b.startSec);
  const duration = topics.durationSec || cues.at(-1).end;
  const chapters = segs.map((sg, i) => ({
    id: sg.id,
    topic: sg.topic,
    start: sg.startSec,
    end: i + 1 < segs.length ? segs[i + 1].startSec : duration,
    cues: [],
  }));

  // 每条字幕归到所属章节
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const ch = chapters.find((x) => c.start >= x.start - 1 && c.start < x.end);
    if (ch) ch.cues.push({ i: i + 1, start: c.start, end: c.end, text: c.text });
  }

  // 章节权重：句量 × 信息密度
  for (const ch of chapters) {
    ch.weight = ch.cues.reduce((a, c) => a + salience(c.text), 0);
    ch.step = ch.cues.reduce((a, c) => a + (c.text.match(RE_STEP) ?? []).length, 0);
    ch.num = ch.cues.reduce((a, c) => a + (c.text.match(RE_NUM) ?? []).length, 0);
    ch.warn = ch.cues.reduce((a, c) => a + (c.text.match(RE_WARN) ?? []).length, 0);
    // 「高光句」：观众真正会去标记的是少数几个瞬间（给参数、下结论、演示操作），
    // 不是均匀撒满整章 —— 有了它热力图才会出现真正的尖峰
    ch.hot = [...ch.cues]
      .filter((c) => c.text.length >= 12)
      .map((c) => ({ c, s: salience(c.text) * (c.text.length > 24 ? 1.35 : 1) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 4)
      .map((x) => x.c);
  }
  const live = chapters.filter((c) => c.cues.length > 0);
  if (!live.length) continue;

  // 观众规模：跟真实峰值挂钩（峰值小 → 参与人少，不吹）
  const peak = s.maxConcurrency || 0;
  const viewers = Math.max(6, Math.min(34, Math.round(peak * 2.2) + 8));
  // 卡片总量：人均 1.6~3.2 张，长课更多
  const perViewer = 1.6 + Math.min(1.6, duration / 3600 / 1.6);
  const total = Math.max(viewers, Math.round(viewers * perViewer));

  const rnd = mulberry32(hash(sid) ^ 0x9e3779b9);
  const cards = [];
  const used = new Set(); // viewer+cue 去重
  const recent = new Map(); // viewer → 最近卡时间，避免同一人一分钟内狂点

  let guard = 0;
  while (cards.length < total && guard++ < total * 40) {
    // 1) 挑章节
    const totalW = live.reduce((a, c) => a + c.weight, 0);
    let r = rnd() * totalW;
    let ch = live[0];
    for (const c of live) { r -= c.weight; if (r <= 0) { ch = c; break; } }

    // 2) 章节内挑句子：55% 落在该章的高光句上（尖峰），其余按信息密度加权（长尾）
    let cue;
    if (ch.hot.length && rnd() < 0.55) {
      cue = ch.hot[Math.floor(rnd() * ch.hot.length)];
    } else {
      const cw = ch.cues.map((c) => salience(c.text));
      const sum = cw.reduce((a, b) => a + b, 0);
      let rr = rnd() * sum;
      let pick = 0;
      for (let i = 0; i < cw.length; i++) { rr -= cw[i]; if (rr <= 0) { pick = i; break; } }
      cue = ch.cues[pick];
    }

    // 3) 观众
    const viewerIdx = 1 + Math.floor(rnd() * viewers);
    const viewer = `v${String(viewerIdx).padStart(2, '0')}`;
    const before = recent.get(viewer);
    if (before != null && Math.abs(before - cue.start) < 120) continue;
    const key = `${viewer}:${cue.i}`;
    if (used.has(key)) continue;
    used.add(key);
    recent.set(viewer, cue.start);

    // 4) 类型：由该句自身的特征决定（有参数更可能是疑问，有步骤更可能是 step）
    const txt = cue.text;
    const hasStep = RE_STEP.test(txt) && (txt.match(RE_STEP) ?? []).length > 0;
    const hasNum = /\d{2,}|kbps|fps|帧/.test(txt);
    const hasWarn = /注意|容易|区别|为什么|如果|不要/.test(txt);
    const p = rnd();
    let type;
    if (hasStep && p < 0.45) type = 'step';
    else if (hasNum && p < 0.5) type = 'question';
    else if (hasWarn && p < 0.42) type = 'question';
    else if (p < 0.62) type = 'key';
    else if (p < 0.8) type = 'question';
    else if (p < 0.92) type = 'step';
    else type = 'case';

    // 少量「疑似讲错」卡：只有讲师口误风险高的句子才可能出现
    if (type !== 'step' && /其实是|不是.*是|应该是|注意.*不要|反过来/.test(txt) && rnd() < 0.22) type = 'fix';

    const notePool = NOTES[type] ?? [];
    const note = rnd() < 0.34 && notePool.length ? notePool[Math.floor(rnd() * notePool.length)] : '';

    cards.push({
      id: `k_${sid.slice(-4)}_${String(cards.length + 1).padStart(3, '0')}`,
      t: Math.round(cue.start),
      cue: cue.i,
      quote: quoteAt(cues, cue.i),
      chapterId: ch.id,
      chapter: ch.topic,
      type,
      viewer,
      note,
      createdAt: new Date((s.startTime ?? Date.now()) + cue.start * 1000 + 1000 * 60 * 30).toISOString().replace('T', ' ').slice(0, 19),
    });
  }

  // 5) 少量「疑似讲错」卡：只有语义上真有歧义的句子才可能出现（不是随机撒）
  const FIX_RE = /其实是|其实不是|反过来|应该是|注意.{0,8}不要|口误|说错/;
  const fixPool = [];
  for (const ch of live) {
    for (const c of ch.cues) {
      if (!FIX_RE.test(c.text)) continue;
      if (c.text.length < 12) continue;
      fixPool.push({ ch, cue: c, w: salience(c.text) * (c.text.length > 30 ? 1.6 : 1) });
    }
  }
  fixPool.sort((a, b) => b.w - a.w);
  const fixQuota = Math.max(1, Math.min(4, Math.round(total * 0.06)));
  let fixMade = 0;
  for (const f of fixPool) {
    if (fixMade >= fixQuota) break;
    const key = `fix:${f.cue.i}`;
    if (used.has(key) || cards.some((c) => c.cue === f.cue.i && c.type === 'fix')) continue;
    used.add(key);
    const viewer = `v${String(1 + Math.floor(rnd() * viewers)).padStart(2, '0')}`;
    cards.push({
      id: `k_${sid.slice(-4)}_${String(cards.length + 1).padStart(3, '0')}`,
      t: Math.round(f.cue.start),
      cue: f.cue.i,
      quote: quoteAt(cues, f.cue.i),
      chapterId: f.ch.id,
      chapter: f.ch.topic,
      type: 'fix',
      viewer,
      note: /\d/.test(f.cue.text) ? NOTES.fix[1] : NOTES.fix[0],
      createdAt: new Date((s.startTime ?? Date.now()) + f.cue.start * 1000 + 1000 * 60 * 30).toISOString().replace('T', ' ').slice(0, 19),
    });
    fixMade++;
  }

  cards.sort((a, b) => a.t - b.t);
  const byType = {};
  for (const c of cards) byType[c.type] = (byType[c.type] ?? 0) + 1;

  const out = {
    sessionId: sid,
    source: 'sim',
    disclaimer:
      '卡片位置与台词来自真实 SRT 字幕与官方 AI 大纲；「谁标记、标记几张、标成什么类型」为模拟数据，可按 _schema.json 换成观众端真实上送。',
    viewers: new Set(cards.map((c) => c.viewer)).size,
    cards,
  };
  writeJson(path.join(CONTRACT, 'cards', `${sid}.json`), out);
  index.push({ sessionId: sid, title: s.title, cards: cards.length, viewers: out.viewers, byType });

  report.push(`${sid}  cards=${cards.length} viewers=${out.viewers} peak=${peak} types=${JSON.stringify(byType)}`);
}

writeJson(path.join(CONTRACT, 'cards', '_schema.json'), schema);
writeJson(path.join(CONTRACT, 'cards', 'index.json'), {
  meta: { generatedAt: new Date().toISOString(), source: 'sim', sessions: index.length },
  sessions: index,
});

console.log('[cards] ' + report.length + ' sessions');
for (const line of report) console.log('[cards] ' + line);
