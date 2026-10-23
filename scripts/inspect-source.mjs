/**
 * 一次性排查：演示场次的片源能否被观众端播放 + 官方大纲的字段结构
 * 用法：node scripts/inspect-source.mjs  → tmp/source-report.md
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const RAW = path.join(ROOT, 'public', 'data', 'raw');
const OUT = path.join(ROOT, 'tmp', 'source-report.md');
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const readJson = (p, fb = null) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fb);
const listRaw = readJson(path.join(RAW, 'record-file-list.json'), { contents: [] });
const files = Array.isArray(listRaw) ? listRaw : (listRaw.contents ?? []);

let md = '# 演示片源与官方大纲排查\n\n';

md += '## 录制文件（可用于 record 直接播放）\n\n';
md += '| fileId | channelSessionId | 时长(s) | mp4 | m3u8 | 字幕 |\n|---|---|---|---|---|---|\n';
for (const f of files) {
  const hasMp4 = !!(f.mp4 || (Array.isArray(f.mp4List) && f.mp4List.length));
  const hasM3u8 = !!(f.m3u8 || (Array.isArray(f.m3u8List) && f.m3u8List.length));
  const subs = Array.isArray(f.subtitleList) ? f.subtitleList.length : 0;
  md += `| ${f.fileId} | ${f.channelSessionId} | ${f.duration} | ${hasMp4} | ${hasM3u8} | ${subs} |\n`;
}

md += '\n## 录制文件原始字段（第一条）\n\n```json\n';
const first = files[0] ?? {};
const slim = {};
for (const [k, v] of Object.entries(first)) {
  if (Array.isArray(v)) slim[k] = `[${v.length} items]`;
  else if (typeof v === 'string' && v.length > 120) slim[k] = v.slice(0, 120) + '…';
  else slim[k] = v;
}
md += JSON.stringify(slim, null, 2) + '\n```\n\n';

// 大纲
const outlineDir = path.join(RAW, 'outlines');
const oFiles = fs.existsSync(outlineDir) ? fs.readdirSync(outlineDir) : [];
for (const name of oFiles) {
  const o = readJson(path.join(outlineDir, name));
  md += `## 官方大纲 ${name}\n\n顶层字段：${Object.keys(o).join(', ')}\n\n`;
  const content = o.outlineContent ?? o.content ?? o;
  md += '```json\n' + JSON.stringify(content, null, 1).slice(0, 1600) + '\n```\n\n';
}

fs.writeFileSync(OUT, md, 'utf8');
console.log('[inspect-source] -> ' + OUT);
