/**
 * AI 复盘总结（手动触发、按视频缓存）
 *
 * 分工：数字全部来自规则引擎（server/teacher.mjs 已算好的报告），
 * 模型只负责把数字翻译成讲师能直接执行的话。
 * 生成结果会做「数字白名单」校验：只要模型引用了输入里没有的数字，直接判失败、不落盘。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatJson, describeProvider } from './llm.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const summaryDir = path.join(projectRoot, 'work', 'summaries');

const SYSTEM = `你是保利威「秒记卡」的教学复盘助手，读者是这门点播课的老师。
你会收到一份由规则引擎算好的结构化证据：课程规模、秒记类型分布、热点区段、以及每条已生成的诊断。
你的任务是把这些数字翻译成老师能直接执行的话。

硬性约束：
1. 只能引用输入里出现过的数字，禁止自己计算、推算、四舍五入出新数字。
2. 不要复述数字本身，要说「这说明什么」。
3. 每条建议必须是老师下一节课能立刻做的一个动作，动词开头。
4. 如果秒记数量很少（少于 12 张），verdict 里要明确说明样本还不足、结论仅供参考。
5. 语气克制、具体，不要营销腔，不要感叹号。

只输出一个 JSON 对象，结构：
{"verdict":"不超过 120 字的总体判断","findings":{"<diagnosis id>":{"judgment":"不超过 120 字，说明这段为什么值得注意","action":"不超过 60 字，下一步做什么"}},"nextActions":["不超过 3 条，每条不超过 40 字"]}`;

function fmt(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}'${String(s % 60).padStart(2, '0')}"`;
}

const TYPE_CN = { key: '重点', question: '疑问', step: '操作步骤', case: '案例', fix: '存疑' };

function safeName(videoKey) {
  return String(videoKey).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
}

function summaryFile(videoKey) {
  return path.join(summaryDir, `${safeName(videoKey)}.json`);
}

/** 组装喂给模型的证据（只放事实，不放模板措辞） */
export function buildEvidence(report, cards) {
  const byType = report.scale.byType ?? {};
  return {
    course: {
      title: report.title,
      durationMinutes: Math.round(report.scale.durationSec / 60),
      students: report.scale.viewers,
      cards: report.scale.cards,
      cardsPerStudent: report.scale.perViewer,
      cardsPerMinute: report.scale.perMin,
      typeBreakdown: Object.fromEntries(
        Object.entries(byType).map(([k, v]) => [TYPE_CN[k] ?? k, v]),
      ),
    },
    hotspots: (report.hotspots ?? []).map((h) => ({
      id: h.id,
      from: fmt(h.t0),
      to: fmt(h.t1),
      cards: h.cards,
      densityRatio: h.ratio,
      chapter: h.chapter ?? null,
      types: Object.fromEntries(Object.entries(h.byType ?? {}).filter(([, v]) => v > 0).map(([k, v]) => [TYPE_CN[k] ?? k, v])),
      samples: (h.samples ?? []).slice(0, 3).map((s) => ({
        at: fmt(s.t),
        type: TYPE_CN[s.type] ?? s.type,
        text: String(s.quote ?? '').slice(0, 40),
      })),
    })),
    findings: (report.findings ?? []).map((f) => ({
      id: f.id,
      level: f.level,
      title: f.title,
      from: fmt(f.t0),
      to: fmt(f.t1),
    })),
    recentCards: (cards ?? []).slice(-12).map((c) => ({
      at: fmt(c.time),
      type: TYPE_CN[c.type] ?? c.type,
      text: String(c.summary || c.subtitle || '').slice(0, 36),
    })),
  };
}

function collectNumbers(value, out = new Set()) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.add(String(value));
    out.add(String(Math.round(value)));
    out.add(value.toFixed(1));
    out.add(value.toFixed(2));
  } else if (typeof value === 'string') {
    for (const m of value.matchAll(/\d+(?:\.\d+)?/g)) out.add(m[0]);
  } else if (Array.isArray(value)) {
    for (const item of value) collectNumbers(item, out);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectNumbers(item, out);
  }
  return out;
}

/** 输出里出现了证据里没有的数字 → 判定为编造 */
function validateOutput(data, evidence) {
  const allowed = collectNumbers(evidence);
  for (let i = 0; i <= 10; i += 1) allowed.add(String(i));

  const text =
    `${data.verdict ?? ''} ` +
    (data.nextActions ?? []).join(' ') +
    ' ' +
    Object.values(data.findings ?? {})
      .map((f) => `${f?.judgment ?? ''} ${f?.action ?? ''}`)
      .join(' ');

  const offending = [];
  for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) {
    if (!allowed.has(m[0])) offending.push(m[0]);
  }
  return [...new Set(offending)];
}

export async function readSummary(videoKey) {
  try {
    const raw = await readFile(summaryFile(videoKey), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function generateSummary({ report, cards, videoKey, force = false }) {
  const provider = describeProvider();
  if (!provider.ready) {
    return {
      ok: false,
      code: 'no-provider',
      reason: '服务端没有配置模型 key（LLM_API_KEY / DEEPSEEK_API_KEY / DASHSCOPE_API_KEY）',
      provider,
    };
  }
  if (!force) {
    const cached = await readSummary(videoKey);
    if (cached) return { ok: true, cached: true, summary: cached, provider };
  }

  const evidence = buildEvidence(report, cards);
  const user = `以下是本课的规则引擎证据（JSON）：\n${JSON.stringify(evidence, null, 1)}\n\n请按系统提示输出 JSON。`;

  let result;
  try {
    result = await chatJson({ system: SYSTEM, user, temperature: 0.2 });
  } catch (error) {
    return { ok: false, code: 'llm-error', reason: error.message, provider };
  }

  const offending = validateOutput(result.data, evidence);
  if (offending.length) {
    return {
      ok: false,
      code: 'fabricated-number',
      reason: `模型引用了证据里没有的数字：${offending.slice(0, 5).join(', ')}`,
      provider,
    };
  }

  const summary = {
    videoKey,
    generatedAt: new Date().toISOString(),
    provider: result.provider,
    model: result.model,
    cardsAtGeneration: report.scale.cards,
    verdict: String(result.data.verdict ?? '').slice(0, 400),
    findings: result.data.findings ?? {},
    nextActions: Array.isArray(result.data.nextActions) ? result.data.nextActions.slice(0, 3) : [],
    usage: result.usage,
  };

  await mkdir(summaryDir, { recursive: true });
  await writeFile(summaryFile(videoKey), JSON.stringify(summary, null, 1), 'utf8');
  return { ok: true, cached: false, summary, provider };
}
