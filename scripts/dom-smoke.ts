/**
 * 集成自检：用 stub DOM + 文件 fetch，真正跑一遍 src/main.ts 的渲染流程。
 * 目的：在没有浏览器的环境里验证「点开面板」不会白屏。
 *
 * 用法：npx esbuild scripts/dom-smoke.ts --bundle --platform=node --format=cjs --outfile=tmp.cjs && node tmp.cjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const els = new Map<string, { innerHTML: string; addEventListener: () => void }>();

const makeEl = (sel: string) => {
  if (!els.has(sel)) els.set(sel, { innerHTML: '', addEventListener: () => {} });
  return els.get(sel)!;
};

// @ts-expect-error stub
globalThis.document = {
  querySelector: (sel: string) => makeEl(sel),
  querySelectorAll: () => [],
};
// @ts-expect-error stub
globalThis.window = {};

// @ts-expect-error stub
globalThis.fetch = async (url: string) => {
  const rel = url.replace(/^\//, '');
  const file = path.join(ROOT, 'public', rel);
  try {
    const text = readFileSync(file, 'utf8');
    return { ok: true, json: async () => JSON.parse(text) };
  } catch {
    return { ok: false, json: async () => null };
  }
};

await import('../src/app');
await new Promise((r) => setTimeout(r, 60));

const checks: [string, string, string][] = [
  ['#app', 'sessions', '整体骨架'],
  ['#sessions', 'sess ', '场次列表'],
  ['#headline', '完整度', '标题区'],
  ['#kpis', 'kpiValue', 'KPI 卡'],
  ['#chart', '<svg', '图表 SVG'],
  ['#report', '归因', '归因区'],
];

let pass = 0;
for (const [sel, needle, name] of checks) {
  const html = els.get(sel)?.innerHTML ?? '';
  const ok = html.includes(needle);
  if (ok) pass++;
  console.log(`${ok ? '✅' : '❌'} ${name.padEnd(8)} ${sel.padEnd(11)} ${html.length} 字节 ${ok ? '' : `(缺 "${needle}")`}`);
}

// 内容抽查
const chart = els.get('#chart')?.innerHTML ?? '';
const report = els.get('#report')?.innerHTML ?? '';
console.log(`\n图表内含: 曲线=${chart.includes('class="online"')} 色带=${chart.includes('class="seg"')} 掉人带=${chart.includes('dropband')}`);
console.log(`报告内含: 档位标签=${report.includes('tier-')} 证据链=${report.includes('证据链') || report.includes('完整度')}`);
console.log(`\n${pass}/${checks.length} 项通过`);
process.exit(pass === checks.length ? 0 : 1);
