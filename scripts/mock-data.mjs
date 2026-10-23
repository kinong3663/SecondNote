/**
 * ReLive · mock 数据生成
 *
 * 产出（前端只读这两个文件，永远不碰密钥）：
 *   public/data/history.json  上一场直播的三线数据 + 分段（彩排的判卷基线）
 *   public/data/script.json   本次要彩排的台本（9 段提纲）
 *
 * 用法：node scripts/mock-data.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'public', 'data');
fs.mkdirSync(OUT, { recursive: true });

const DURATION = 2400; // 40 分钟
const BUCKET = 5;      // 5 秒一个采样点

/** 上一场的分段（含互动钩子数量），用来当彩排基线 */
const historySegments = [
  { id: 'h1', startSec: 0,    endSec: 180,  topic: '开场与自我介绍', hook: 2 },
  { id: 'h2', startSec: 180,  endSec: 480,  topic: '行业痛点',       hook: 1 },
  { id: 'h3', startSec: 480,  endSec: 900,  topic: '产品能力总览',   hook: 1 },
  { id: 'h4', startSec: 900,  endSec: 1200, topic: '现场演示',       hook: 2 },
  { id: 'h5', startSec: 1200, endSec: 1500, topic: '客户案例',       hook: 1 },
  { id: 'h6', startSec: 1500, endSec: 1860, topic: '价格与套餐',     hook: 0 },
  { id: 'h7', startSec: 1860, endSec: 2160, topic: '服务与交付',     hook: 0 },
  { id: 'h8', startSec: 2160, endSec: 2400, topic: '答疑与收尾',     hook: 3 },
];

/** 分段锚点（秒 → 在线人数），锚点间线性插值；总跌幅约 -16%，掉人集中在「价格与套餐」 */
const anchors = [
  [0, 860], [180, 848], [480, 872], [900, 806], [1200, 824],
  [1500, 792], [1860, 702], [2160, 726], [2400, 718],
];

function interp(t) {
  for (let i = 0; i < anchors.length - 1; i++) {
    const [t0, v0] = anchors[i];
    const [t1, v1] = anchors[i + 1];
    if (t >= t0 && t < t1) return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
  }
  return anchors.at(-1)[1];
}

function buildSeries() {
  const series = [];
  for (let t = 0; t < DURATION; t += BUCKET) {
    const seg = historySegments.find((s) => t >= s.startSec && t < s.endSec) ?? historySegments.at(-1);
    const progress = (t - seg.startSec) / Math.max(1, seg.endSec - seg.startSec);
    const online = Math.max(300, Math.round(interp(t) + (Math.random() - 0.5) * 12));
    // 弹幕强度：有互动钩子的段落更高，段落开头 15 秒有反应峰值
    const base = seg.hook * 1.6 + 0.6;
    const burst = progress < 0.08 ? base * 3.2 : base;
    const chat = Math.max(0, Math.round(burst + (Math.random() - 0.5) * base));
    series.push({
      t,
      online,
      chat,
      sentiment: chat === 0 ? 0 : Number(((Math.random() - 0.35) * 0.6).toFixed(2)),
    });
  }
  return series;
}

const series = buildSeries();
const history = {
  meta: {
    channelId: '4711207',
    title: 'Q3 企业直播实战分享',
    date: '2026-10-09',
    durationSec: DURATION,
    bucketSec: BUCKET,
    source: 'mock',
    generatedAt: new Date().toISOString(),
  },
  segments: historySegments,
  series,
};
fs.writeFileSync(path.join(OUT, 'history.json'), JSON.stringify(history, null, 2), 'utf8');

/** 本次要彩排的台本：故意把「价格与套餐」写成又长又平的段落 */
const script = {
  meta: { title: 'Q4 新品发布会 · 彩排稿', channelId: '4711207', durationSec: 2400, oralFactor: 4.2 },
  keywords: ['价格', '续费', 'ROI', '试用', '答疑'],
  segments: [
    {
      id: 's1', topic: '开场与自我介绍', startSec: 0, endSec: 150,
      text: '大家好，欢迎来到今天的直播间。我是主讲人林哲，负责企业直播这块业务。今天大概 40 分钟，会讲三件事：行业里大家最头疼的问题、我们这次的新版本、以及怎么申请试用。中间我会问几个问题，大家在公屏上告诉我。',
    },
    {
      id: 's2', topic: '行业痛点', startSec: 150, endSec: 450,
      text: '先说痛点。过去一年我们聊了大概两百家企业，几乎都卡在同一个地方：直播做完了，但没人知道到底哪一段观众看下去了、哪一段人走光了。运营只能凭感觉说「那天互动还不错」——但「还不错」是什么？说不清。',
    },
    {
      id: 's3', topic: '产品能力总览', startSec: 450, endSec: 870,
      text: '新版本把这个事拆成三条线。第一条是在线人数曲线，精确到秒；第二条是弹幕密度和情绪；第三条是讲师到底讲了什么，我们会把字幕切段，和前面两条对齐。三条线放在同一根时间轴上，你就能直接看到：讲到价格的时候，人是怎么走的。',
    },
    {
      id: 's4', topic: '现场演示', startSec: 870, endSec: 1170,
      text: '下面是演示。这是一场 40 分钟的回放，左边是人数，中间是弹幕热力，右边是逐字稿。我把光标放到第 25 分钟——你们看，这里人掉了 12%，同时弹幕是零，逐字稿显示这一段讲了 4 分钟的套餐对比。问题一目了然：不是内容错，是没有让人说话。',
    },
    {
      id: 's5', topic: '客户案例', startSec: 1170, endSec: 1470,
      text: '举一个客户例子。一家做工业设备的公司，他们最贵的直播是新品发布。用之前播了六场，平均停留 11 分钟。用了之后他们改了两次台本的节奏，平均停留到了 19 分钟。怎么改的？其实就是每 8 分钟插一个能让观众说话的问题。',
    },
    {
      id: 's6', topic: '价格与套餐', startSec: 1470, endSec: 1830,
      text: '接下来说一下版本和价格。我们分成标准版、专业版、旗舰版三档。标准版包含基础的观看数据和行为分析，专业版在上面加了 AI 智能大纲和逐字稿检索，旗舰版再往上加多频道统一管理和定制的归因模型。每个版本支持的并发路数不一样，也跟带宽峰值有关，具体要根据你们的场次规模来算。企业采购的话通常需要走一轮评估，我们会提供试用环境和一份迁移方案，迁移周期一般在一到两周左右，取决于你们原来用的系统复杂度。',
    },
    {
      id: 's7', topic: '服务与交付', startSec: 1830, endSec: 2130,
      text: '服务这块说三句：一是有专属的客户成功，二是支持定制化的培训，三是重大场次我们会有技术保障。这三块在旗舰版里都是包含的，专业版可以单独加购。',
    },
    {
      id: 's8', topic: '答疑与收尾', startSec: 2130, endSec: 2320,
      text: '最后留 3 分钟答疑。想问什么直接打在公屏上，我挑三个高频的说。顺便说一句，今天听完想试的，扣个 1，我让同事私信你，开一个 14 天的试用环境。',
    },
    {
      id: 's9', topic: '结束语', startSec: 2320, endSec: 2400,
      text: '今天就到这里，感谢大家的时间。回放和今天的资料我们会发在群里，下次见。',
    },
  ],
};
fs.writeFileSync(path.join(OUT, 'script.json'), JSON.stringify(script, null, 2), 'utf8');

console.log(`✅ public/data/history.json  ${series.length} 个采样点（${DURATION}s / ${BUCKET}s）`);
console.log(`✅ public/data/script.json   ${script.segments.length} 段台本`);
const first = series[0].online;
const last = series.at(-1).online;
console.log(`   上一场在线人数：${first} → ${last}（${(((last - first) / first) * 100).toFixed(1)}%）`);
const zeroChat = series.filter((p) => p.chat === 0).length;
console.log(`   弹幕为 0 的采样点：${zeroChat} / ${series.length}`);
