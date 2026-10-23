/**
 * 把原始素材裁成「可直接拖进时间线」的精简版：
 *   - 去掉开头的页面加载/等待；
 *   - 06 段把中间的「视频加载中」跳切掉（老师端 → 点进去 → 学生端同一秒）。
 *
 * 用法：node trim.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// ffmpeg 默认走 PATH；本机装在别处时可以 $env:FFMPEG_PATH="C:\...\ffmpeg.exe"
const FF = process.env.FFMPEG_PATH || 'ffmpeg';
const SRC = '剪辑素材';
const OUT = path.join(SRC, '精简');
fs.mkdirSync(OUT, { recursive: true });

const beats = JSON.parse(fs.readFileSync(path.join(SRC, 'beats.json'), 'utf8'));

// 每段保留的区间（秒，素材自己的时间轴）；一段多个区间就是跳切
const PARTS = {
  '00': { parts: [[16.6, 28.68]], note: '开场空镜：学生端首屏 + 播放器在播（停在有字幕的位置），无点击' },
  '01': { parts: [[14.5, 46.04]], note: '裁掉学生端加载，从页面出图开始' },
  '02': { parts: [[14.0, 24.52]], note: '裁掉加载，留住「点时间戳跳回 + F5 还在」' },
  '03': { parts: [[16.8, 28.76]], note: '裁掉加载，从点分享开始' },
  '04': { parts: [[11.6, 25.72]], note: '裁掉教师端拉数据，从热力图出图开始' },
  '05': { parts: [[7.0, 27.68]], note: '裁掉加载，从点生成开始' },
  '06': { parts: [[1.2, 12.6], [24.5, 29.32]], note: '老师端定位 → 点回学生端 → 跳到学生端同一秒（中间的加载已跳切）' },
  '07': { parts: [[1.6, 13.6]], note: '收尾空镜：教师端工作台，沿热力图慢扫' },
};

const rebase = (t, parts) => {
  let acc = 0;
  for (const [start, end] of parts) {
    if (t >= start && t <= end) return Number((acc + (t - start)).toFixed(2));
    acc += end - start;
  }
  return null;
};

const trimmed = [];
for (const seg of beats.segments) {
  const spec = PARTS[seg.index];
  const input = path.join(SRC, `${seg.index}-${seg.name}.mp4`);
  const outName = `${seg.index}-${seg.name}.mp4`;
  const out = path.join(OUT, outName);

  const args = ['-y', '-loglevel', 'error', '-i', input];
  if (spec.parts.length === 1) {
    const [start, end] = spec.parts[0];
    args.push('-ss', String(start), '-to', String(end));
  } else {
    const chains = spec.parts
      .map(([s, e], i) => `[0:v]trim=${s}:${e},setpts=PTS-STARTPTS[v${i}]`)
      .join(';');
    const labels = spec.parts.map((_, i) => `[v${i}]`).join('');
    args.push(
      '-filter_complex',
      `${chains};${labels}concat=n=${spec.parts.length}:v=1:a=0[v]`,
      '-map', '[v]',
    );
  }
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out);
  execFileSync(FF, args);

  const duration = Number(
    spec.parts.reduce((sum, [s, e]) => sum + (e - s), 0).toFixed(2),
  );

  trimmed.push({
    index: seg.index,
    name: seg.name,
    file: outName,
    duration,
    cut: spec.parts,
    note: spec.note,
    marks: seg.marks
      .map((m) => ({ name: m.name, t: rebase(m.tInClip, spec.parts) }))
      .filter((m) => m.t !== null),
  });
  console.log(`${outName}  ${duration}s  ${spec.note}`);
}

fs.writeFileSync(path.join(OUT, 'beats.json'), JSON.stringify({ segments: trimmed }, null, 1), 'utf8');
console.log('\n✅ 精简版完成');
for (const t of trimmed) console.log(`   ${t.index} ${t.duration}s  ${t.marks.map((m) => `${m.name}@${m.t}`).join('  ')}`);
