/**
 * ReLive · 模拟多场直播全流程（事件流生成器）
 *
 * 目的：真实数据稀薄（17 场 / 4 场有峰值 / 无弹幕），用它证明"接得上"；
 *      用本生成器造出"从开始到结束"的完整事件流，证明"跑得动"。
 *
 * 每场输出一条按秒排序的事件流（schema 见 ReLive-数据资产与复盘文档方案.md §6.1），
 * 且自检：人为埋的掉人点，必须能被 3 分钟滑窗算法识别（否则这场作废）。
 *
 * 用法：
 *   node scripts/gen-session.mjs                     # 6 场（2 好 2 平庸 2 翻车）
 *   node scripts/gen-session.mjs --count 9 --seed 42
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'public', 'data', 'sim');
fs.mkdirSync(OUT, { recursive: true });

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const COUNT = arg('count', 6);
let seed = arg('seed', 20261023);
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const randInt = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const HOOK_TEXTS = [
  '你们现在几个人在管直播？打在公屏上',
  '听懂的扣 1，没听懂的扣 2',
  '猜一下这个数字是多少？打在公屏上',
  '大家用手边的例子想一下，打在公屏上',
  '有没有踩过这个坑的？扣个 1 我看到',
  '这一页我停 30 秒，有问题直接打在公屏',
];
const CHAT_POOL = [
  '老师好', '这个功能怎么开', '111', '懂了', '能回放吗', '讲得好',
  '我们公司也是这样', '有资料吗', '价格怎么算', '这个坑我们踩过',
  '2', '求课件', '老师能再讲一遍吗', '已签到', '哈哈', '这个数据哪来的',
];
const TOPIC_POOL = [
  { topic: '开场与目标', min: 5, max: 8 },
  { topic: '行业痛点', min: 6, max: 10 },
  { topic: '产品能力总览', min: 8, max: 14 },
  { topic: '现场演示', min: 8, max: 12 },
  { topic: '客户案例', min: 5, max: 9 },
  { topic: '价格与套餐', min: 5, max: 11 },
  { topic: '服务与交付', min: 4, max: 8 },
  { topic: '答疑与收尾', min: 4, max: 7 },
];

/** 三种剧本：profile 是观众曲线形状（相对起点的倍率） */
const SCRIPTS = {
  good:     { hookRatio: 0.85, chatBase: 2.2, stallMax: 0, baseViewers: [60, 140], profile: { peak: 1.45, end: 0.82 }, dropProfile: 'none' },
  mediocre: { hookRatio: 0.55, chatBase: 1.3, stallMax: 1, baseViewers: [30, 90],  profile: { peak: 1.30, end: 0.62 }, dropProfile: 'one' },
  bad:      { hookRatio: 0.3,  chatBase: 0.7, stallMax: 2, baseViewers: [20, 60],  profile: { peak: 1.20, end: 0.40 }, dropProfile: 'many' },
};

/** 生成一场 */
function genSession(idx, kind) {
  const cfg = SCRIPTS[kind];
  const segmentCount = randInt(6, 8);
  // 保持台本逻辑顺序（开场→痛点→产品→演示→案例→价格→服务→答疑），中段随机取舍，首尾必留
  const topics = [...TOPIC_POOL];
  while (topics.length > segmentCount) {
    topics.splice(randInt(1, topics.length - 2), 1);
  }

  // 1) 切段：决定每段时长与是否有钩子
  let t = 0;
  const segments = topics.map((tp, i) => {
    let min = randInt(tp.min, tp.max);
    // 掉人剧本：把某些段落拉长（长段=风险），好剧本则压短
    if (cfg.dropProfile === 'many' && i % 3 === 1) min = Math.round(min * 1.7);
    if (cfg.dropProfile === 'none') min = Math.max(3, Math.round(min * 0.75));
    const startSec = t;
    t += min * 60;
    const hasHook = rnd() < cfg.hookRatio || i === 0 || i === segmentCount - 1;
    return { id: `t${i + 1}`, startSec, endSec: t, topic: tp.topic, minutes: min, hasHook, hookText: pick(HOOK_TEXTS) };
  });
  const durationSec = t;

  // 2) 事件流
  const events = [];
  const v0 = randInt(cfg.baseViewers[0], cfg.baseViewers[1]);
  const peak = v0 * cfg.profile.peak;
  const end = v0 * cfg.profile.end;
  /** 全场基线曲线：开场→爬升→峰值→收尾（锚点线性插值） */
  const anchors = [
    [0, v0],
    [durationSec * 0.12, v0 * 1.08],
    [durationSec * 0.45, peak],
    [durationSec * 0.78, (peak + end) / 2],
    [durationSec, end],
  ];
  const baseline = (t) => {
    for (let i = 0; i < anchors.length - 1; i++) {
      const [t0, a] = anchors[i];
      const [t1, b] = anchors[i + 1];
      if (t >= t0 && t < t1) return a + ((b - a) * (t - t0)) / (t1 - t0);
    }
    return end;
  };

  const engineeredDrops = [];
  for (const seg of segments) {
    const steps = Math.floor((seg.endSec - seg.startSec) / 30);
    // 风险段：没钩子且够长 → 段内额外挖一个 15% 的坑（这是"埋点"，检测算法必须能找回来）
    const riskSegment = !seg.hasHook && seg.minutes >= 6;
    const dipCenter = riskSegment ? seg.startSec + (seg.endSec - seg.startSec) * 0.5 : 0;
    const dipHalf = riskSegment ? Math.min(240, (seg.endSec - seg.startSec) * 0.3) : 0;

    for (let s = 0; s < steps; s++) {
      const at = seg.startSec + s * 30;
      let v = baseline(at);
      if (riskSegment && Math.abs(at - dipCenter) < dipHalf) {
        // 钟形坑：中心掉 15%
        const x = (at - dipCenter) / dipHalf;
        v *= 1 - 0.15 * (1 - x * x);
      }
      v = Math.max(3, v + (rnd() - 0.5) * v * 0.012);
      events.push({ t: at, type: 'viewer', viewers: Math.round(v) });

      // 弹幕：钩子后 90 秒有峰值；长空窗段弹幕趋零
      const hookBurst = seg.hasHook && s * 30 < 90;
      const rate = hookBurst ? cfg.chatBase * 4 : riskSegment ? cfg.chatBase * 0.25 : cfg.chatBase;
      const n = Math.max(0, Math.round(rate + (rnd() - 0.5) * cfg.chatBase));
      for (let k = 0; k < n; k++) {
        events.push({
          t: at + randInt(0, 29),
          type: 'chat',
          user: `观众${randInt(1, 40)}`,
          text: pick(CHAT_POOL),
          sentiment: Number(((rnd() - 0.3) * 0.8).toFixed(2)),
        });
      }
      if (rnd() < (hookBurst ? 0.5 : 0.12)) events.push({ t: at, type: 'like', count: randInt(1, 15) });
    }

    if (riskSegment) {
      engineeredDrops.push({ startSec: dipCenter - dipHalf, endSec: dipCenter + dipHalf, topic: seg.topic });
    }

    // 段落切换处：公告 / 互动 / 转场
    if (seg.hasHook) {
      events.push({
        t: seg.startSec + 5,
        type: 'interact',
        kind: pick(['notice', 'answer_card', 'checkin', 'lottery', 'questionnaire']),
        payload: { text: seg.hookText, joined: Math.round(baseline(seg.startSec) * (0.3 + rnd() * 0.5)) },
      });
    }
  }

  // 3) 技术卡顿：落在高峰时段
  for (let i = 0; i < randInt(0, cfg.stallMax); i++) {
    events.push({ t: randInt(durationSec * 0.2, durationSec * 0.9), type: 'player', event: 'stall', ms: randInt(1500, 6000) });
  }
  // 4) 打赏（稀发）
  if (rnd() < 0.4) events.push({ t: randInt(300, durationSec - 300), type: 'donate', amount: Number((rnd() * 20).toFixed(1)) });

  events.sort((a, b) => a.t - b.t);

  const startTime = new Date('2026-11-05T06:00:00Z').getTime() + idx * 864e5;
  return {
    sessionId: `sim_${String(idx + 1).padStart(2, '0')}`,
    channelId: '4711207',
    title: `${pick(['Q4 产品内训', 'AI 数字人共创社', '客户成功工作坊', '新功能发布说明会'])} · 第 ${idx + 1} 讲`,
    scenario: kind,
    startTime,
    endTime: startTime + durationSec * 1000,
    durationSec,
    source: 'sim',
    segments: segments.map(({ id, startSec, endSec, topic, hasHook }) => ({ id, startSec, endSec, topic, hasHook })),
    engineeredDrops,
    events,
  };
}

/**
 * 3 分钟滑窗检测（与复盘引擎同一套算法，用于自检）
 * 关键：用「全场窗口中位跌幅」做基准做去趋势，否则自然下滑会被误判成掉人点。
 */
function detectDrops(series, windowSec = 180, top = 5) {
  const pts = series.filter((e) => e.type === 'viewer');
  if (pts.length < 4) return [];
  const step = 30;
  const w = Math.floor(windowSec / step);
  const all = [];
  for (let i = 0; i + w < pts.length; i++) {
    const a = pts[i].viewers;
    const b = pts[i + w].viewers;
    all.push({ startSec: pts[i].t, endSec: pts[i + w].t, drop: (b - a) / a, from: a, to: b });
  }
  const median = [...all].map((c) => c.drop).sort((x, y) => x - y)[Math.floor(all.length / 2)];
  const cands = all
    .map((c) => ({ ...c, abnormal: c.drop - median }))
    .filter((c) => c.abnormal < -0.08)   // 相对全场中位的"异常下跌"
    .sort((x, y) => x.abnormal - y.abnormal);

  const out = [];
  for (const c of cands) {
    if (out.some((o) => Math.abs(o.startSec - c.startSec) < windowSec)) continue;
    out.push(c);
    if (out.length >= top) break;
  }
  return out;
}

// ---- 生成 ----
const kinds = ['good', 'mediocre', 'bad'];
const sessions = [];
let ok = 0;
for (let i = 0; i < COUNT; i++) {
  const kind = kinds[i % 3];
  const s = genSession(i, kind);
  const detected = detectDrops(s.events);
  const hit = s.engineeredDrops.filter((d) => detected.some((x) => x.startSec >= d.startSec - 240 && x.startSec <= d.endSec));
  const miss = s.engineeredDrops.length - hit.length;
  const pass = s.engineeredDrops.length === 0 ? detected.length === 0 : hit.length > 0;
  if (pass) ok++;

  const chatCount = s.events.filter((e) => e.type === 'chat').length;
  const interacts = s.events.filter((e) => e.type === 'interact').length;
  const stalls = s.events.filter((e) => e.type === 'player').length;
  const v0 = s.events.find((e) => e.type === 'viewer')?.viewers ?? 0;
  const v1 = [...s.events].reverse().find((e) => e.type === 'viewer')?.viewers ?? 0;

  console.log(
    `${pass ? '✅' : '⚠️ '} ${s.sessionId} ${kind.padEnd(9)} ${String(Math.round(s.durationSec / 60)).padStart(3)}min  ` +
    `观众 ${String(v0).padStart(3)}→${String(v1).padStart(3)}  弹幕 ${String(chatCount).padStart(4)}  互动 ${interacts}  卡顿 ${stalls}  ` +
    `埋点 ${s.engineeredDrops.length} 检出 ${detected.length}${miss ? ` (漏 ${miss})` : ''}`,
  );
  if (detected[0]) {
    const d = detected[0];
    const mmss = (x) => `${Math.floor(x / 60)}'${String(x % 60).padStart(2, '0')}"`;
    console.log(`      最陡掉人点 ${mmss(d.startSec)}-${mmss(d.endSec)}  ${d.from}→${d.to} 人 (${(d.drop * 100).toFixed(1)}%)`);
  }

  fs.writeFileSync(path.join(OUT, `${s.sessionId}.json`), JSON.stringify(s, null, 1), 'utf8');
  sessions.push({ sessionId: s.sessionId, title: s.title, scenario: kind, durationSec: s.durationSec, startTime: s.startTime, events: s.events.length, chat: chatCount, interacts, stalls, drops: detected.length });
}

fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ generatedAt: new Date().toISOString(), sessions }, null, 2), 'utf8');
console.log(`\n共 ${COUNT} 场 → ${ok} 场通过自检（埋点可被检出）`);
console.log(`输出目录：public/data/sim/（含 index.json）`);
