const fs = require('fs');
const beats = require('./raw/segments/beats.json');
const ff = require('child_process');
const FF = 'C:/Users/zhong/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffprobe.exe';
const dur = (f) => Number(ff.execFileSync(FF, ['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',f]).toString().trim());
for (const s of beats.segments) {
  const v = dur(`剪辑素材/${s.index}-${s.name}.mp4`);
  s.videoDuration = Number(v.toFixed(2));
  s.videoOffset = Number((v - s.duration - 0.1).toFixed(2));
  s.marks = s.marks.map((m) => ({ name: m.name, t: m.t, tInClip: Number((m.t + s.videoOffset).toFixed(2)) }));
}
fs.writeFileSync('raw/segments/beats.json', JSON.stringify(beats, null, 1), 'utf8');
fs.copyFileSync('raw/segments/beats.json', '剪辑素材/beats.json');
console.log(beats.segments.map((s) => `${s.index} ${s.name} clip=${s.videoDuration}s offset=${s.videoOffset}s`).join('\n'));
