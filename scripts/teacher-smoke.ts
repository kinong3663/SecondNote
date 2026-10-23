/**
 * 教师端集成自检：stub DOM + 文件 fetch，真跑一遍 src/teacher.ts 的渲染。
 * 目的：没有浏览器的环境里验证「打开教师端」不会白屏，且关键模块真的画出来了。
 *
 * 用法：npx esbuild scripts/teacher-smoke.ts --bundle --platform=node --format=esm --outfile=tmp-teacher.mjs && node tmp-teacher.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const app = { innerHTML: '', addEventListener: () => {} };
const heat = { scrollIntoView: () => {} };

// @ts-expect-error stub
globalThis.document = {
  getElementById: (id: string) => (id === 'app' ? app : id === 'heat' ? heat : null),
  querySelector: () => null,
  querySelectorAll: () => [],
};
// @ts-expect-error stub
globalThis.window = { scrollTo: () => {} };

// @ts-expect-error stub
globalThis.fetch = async (url: string) => {
  const rel = String(url).replace(/^\//, '');
  const file = path.join(ROOT, 'public', rel);
  try {
    const text = readFileSync(file, 'utf8');
    return { ok: true, json: async () => JSON.parse(text) };
  } catch {
    return { ok: false, json: async () => null };
  }
};

await import('../src/teacher');
await new Promise((r) => setTimeout(r, 50));

const html = app.innerHTML;
const count = (needle: string): number => html.split(needle).length - 1;

const checks: [string, boolean, string][] = [
  ['顶栏与数据来源徽章', html.includes('教师端 · 观众记住卡复盘') && html.includes('bdgSim'), ''],
  ['场次切换', count('class="tsess') >= 3, `找到 ${count('class="tsess')} 个`],
  ['KPI 卡 6 个', count('class="kpi"') === 6, `实际 ${count('class="kpi"')}`],
  ['热力图 SVG', html.includes('class="heatmap"'), ''],
  ['热力网格 5 类 + 合计', count('class="rowlabelT"') === 6, `实际 ${count('class="rowlabelT"')}`],
  ['合计行', html.includes('合计</text>'), ''],
  ['可点击热力格', count('data-type=') > 30, `${count('data-type=')} 格`],
  ['热点条', count('class="hsbar"') >= 1, `${count('class="hsbar"')} 条`],
  ['官方章节带', count('class="bandlabel"') >= 3, `${count('class="bandlabel"')} 段`],
  ['在线人数曲线', html.includes('在线人数（真实曲线'), ''],
  ['AI 结论', html.includes('AI 复盘结论') && html.includes('class="verdict"'), ''],
  ['可执行计划 3 条', count('class="pn"') === 3, `实际 ${count('class="pn"')}`],
  ['诊断卡 ≥3 条', count('class="finding ') >= 3, `${count('class="finding ')} 条`],
  ['每条诊断带证据', count('class="ev"') >= 9, `${count('class="ev"')} 条证据`],
  ['下一步动作', count('class="factK"') >= 2, `${count('class="factK"')} 条`],
  ['卡片流', count('class="mcard"') >= 20, `${count('class="mcard"')} 张`],
  ['无 NaN / undefined', !html.includes('NaN') && !html.includes('undefined'), ''],
  ['无负宽高', !/width="-|height="-/.test(html), ''],
];

let pass = 0;
for (const [name, ok, extra] of checks) {
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(18)} ${extra}`);
}

const ev = count('class="ev"');
console.log(`\n结构: 卡片 ${count('class="mcard"')} · 格 ${count('data-type=')} · 诊断 ${count('class="finding ')} · 证据 ${ev}`);
console.log(`${pass}/${checks.length} 项通过`);
process.exit(pass === checks.length ? 0 : 1);
