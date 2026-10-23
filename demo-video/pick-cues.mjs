/** 挑几个字幕内容像样的时间点，给演示录屏用。输出到 raw/cues.txt */
import fs from 'node:fs';

const file = 'D:/保利威黑客松/秒记卡/work/subtitles/srt-vod-bfcb278e7a88e2d51e23ba453596ddf2_b.json';
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const cues = raw.items ?? raw.cues ?? [];
const targets = [36 * 60 + 21, 59 * 60 + 1, 134 * 60 + 6];

const fmt = (s) => `${Math.floor(s / 60)}'${String(Math.floor(s % 60)).padStart(2, '0')}"`;
const lines = [`共 ${cues.length} 条字幕`];

for (const t of targets) {
  lines.push(`\n=== 目标 ${fmt(t)} (${t}s) ±300s 内最长的 18 条 ===`);
  const near = cues
    .filter((c) => Math.abs(c.start - t) <= 300)
    .sort((a, b) => b.text.trim().length - a.text.trim().length)
    .slice(0, 18)
    .sort((a, b) => a.start - b.start);
  for (const c of near) {
    lines.push(`${String(c.start).padStart(6)} ${fmt(c.start).padStart(9)}  ${c.text.trim()}`);
  }
}

fs.writeFileSync('D:/保利威黑客松/demo-video/raw/cues.txt', lines.join('\n'), 'utf8');
console.log('cues:', cues.length);
