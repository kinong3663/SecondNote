import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchChannelBundle, fetchRecordFiles } from './polyv.mjs';
import { demoBundle } from './demoTranscript.mjs';
import {
  readCachedTranscript,
  transcribeMedia,
  TranscriptServiceError,
} from './transcript.mjs';
import { fetchOutlineChapters, fetchSubtitleCues, fetchVodSubtitleCues } from './subtitles.mjs';
import { fetchVodVideo, fetchVodVideos } from './vod.mjs';
import { appendNote, countNotesByVideo, listNotes, NOTE_TYPES } from './notes.mjs';
import { aggregate } from './teacher.mjs';

const app = express();
const port = Number(process.env.PORT || 8787);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const dist = path.join(projectRoot, 'dist');
const cache = new Map();

function getCredentials() {
  const appId = process.env.POLYV_APP_ID;
  const appSecret = process.env.POLYV_APP_SECRET;
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

function resolveWatchUrl(value) {
  const text = String(value ?? '');
  if (text.startsWith('//')) return `https:${text}`;
  return text;
}

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

app.get('/api/health', (_request, response) => {
  const credentials = getCredentials();
  response.json({
    ok: true,
    polyvConfigured: Boolean(credentials),
    channelId: process.env.POLYV_DEMO_CHANNEL_ID || '8569582',
    defaultVideoId: process.env.POLYV_DEMO_VIDEO_ID || '',
    defaultSource: process.env.POLYV_DEMO_SOURCE || '',
    noteTypes: NOTE_TYPES,
  });
});

app.get('/api/channel/:channelId', async (request, response) => {
  const channelId = String(request.params.channelId);
  const requestedVideoId = String(request.query.vid || process.env.POLYV_DEMO_VIDEO_ID || '');
  const requestedSource = String(request.query.source || process.env.POLYV_DEMO_SOURCE || '');
  if (!/^\d{4,20}$/.test(channelId)) {
    response.status(400).json({ error: '频道号格式不正确。' });
    return;
  }

  const cacheKey = `${channelId}:${requestedSource}:${requestedVideoId}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < 60_000) {
    response.json(cached.value);
    return;
  }

  const credentials = getCredentials();
  if (!credentials) {
    response.json({ ...demoBundle, source: 'demo', reason: 'credentials-missing' });
    return;
  }

  try {
    let channelBundle = await fetchChannelBundle(
      channelId,
      credentials,
      requestedSource,
      requestedVideoId,
    );

    // 演示模式：视频列表只取「点播列表」，不混直播暂存 / 回放。
    // 点播走 mp4 直链（原生 <video>），绕开观看 SDK 的频道授权限制。
    if ((requestedSource || process.env.POLYV_DEMO_SOURCE) === 'vod') {
      try {
        const vods = await fetchVodVideos({
          userid: process.env.POLYV_VOD_USERID,
          secretkey: process.env.POLYV_VOD_SECRETKEY,
          pageSize: Number(process.env.POLYV_VOD_PAGE_SIZE || 50),
        });
        const videos = vods.map((item) => ({
          videoId: item.vid,
          sourceType: 'vod',
          title: item.title,
          duration: item.duration,
          firstImage: item.cover,
          watchUrl: `https://live.polyv.cn/watch/${channelId}?vid=${item.vid}&playbackType=vod`,
          mediaUrl: item.playUrl,
        }));
        const wanted = requestedVideoId || process.env.POLYV_DEMO_VIDEO_ID || '';
        const selected = videos.find((item) => item.videoId === wanted) ?? videos[0];
        if (selected) {
          channelBundle = {
            ...channelBundle,
            videos,
            channel: {
              ...channelBundle.channel,
              videoId: selected.videoId,
              videoSourceType: 'vod',
              videoKey: `vod:${selected.videoId}`,
              videoTitle: selected.title,
              duration: selected.duration,
              firstImage: selected.firstImage,
              watchUrl: selected.watchUrl,
            },
          };
        }
      } catch (error) {
        console.warn(`[second-note] 点播列表不可用: ${error.message}`);
      }
    }

    const video =
      channelBundle.videos.find(
        (item) =>
          item.sourceType === channelBundle.channel.videoSourceType &&
          item.videoId === channelBundle.channel.videoId,
      ) ?? channelBundle.videos[0];

    // 字幕优先级：平台 AI 智能字幕（录制/点播）→ 本地 Whisper 缓存 → 无
    let transcript = [];
    let transcriptSource = 'none';
    let subtitleMeta = '';
    if (video?.subtitleUrl) {
      try {
        transcript = await fetchSubtitleCues(video.subtitleUrl, video.videoId);
        if (transcript.length) transcriptSource = 'polyv';
      } catch (error) {
        console.warn(`[second-note] 平台字幕不可用: ${error.message}`);
      }
    }
    if (!transcript.length && channelBundle.channel.videoSourceType === 'vod') {
      try {
        const vod = await fetchVodSubtitleCues(
          channelBundle.channel.videoId,
          process.env.POLYV_VOD_USERID,
          process.env.POLYV_VOD_SECRETKEY,
        );
        if (vod.cues.length) {
          transcript = vod.cues;
          transcriptSource = 'polyv';
          subtitleMeta = vod.name;
        }
      } catch (error) {
        console.warn(`[second-note] 点播字幕不可用: ${error.message}`);
      }
    }
    if (!transcript.length) {
      const cachedTranscript = await readCachedTranscript(
        channelBundle.channel.videoSourceType,
        channelBundle.channel.videoId,
      );
      if (cachedTranscript?.cues?.length) {
        transcript = cachedTranscript.cues;
        transcriptSource = 'ai';
      }
    }

    // 点播视频的时长接口没给（合成条目 duration=0），用字幕最后一条兜底
    let duration = channelBundle.channel.duration;
    if (!duration && transcript.length) {
      duration = Math.ceil(transcript[transcript.length - 1].end);
      channelBundle.channel.duration = duration;
      const matched = channelBundle.videos.find(
        (item) =>
          item.videoId === channelBundle.channel.videoId &&
          item.sourceType === channelBundle.channel.videoSourceType,
      );
      if (matched) matched.duration = duration;
    }

    // 官方 AI 大纲（章节）
    let chapters = [];
    if (video?.outlineUrl) {
      try {
        chapters = (await fetchOutlineChapters(video.outlineUrl, video.videoId)).map((item) => ({
          title: item.title,
          start: item.start,
          end: item.end,
          summary: item.summary,
        }));
      } catch (error) {
        console.warn(`[second-note] 平台大纲不可用: ${error.message}`);
      }
    }

    const bundle = {
      ...channelBundle,
      transcript,
      transcriptSource,
      subtitleMeta,
      chapters,
    };
    cache.set(cacheKey, { createdAt: Date.now(), value: bundle });
    response.json(bundle);
  } catch (error) {
    console.error(`[second-note] Polyv request failed: ${error.message}`);
    response.json({ ...demoBundle, source: 'demo', reason: 'polyv-unavailable' });
  }
});

/* ---------------- 观众卡片上报（教师端的数据源） ---------------- */

app.post('/api/notes', async (request, response) => {
  const body = request.body ?? {};
  const channelId = String(body.channelId || '');
  const videoKey = String(body.videoKey || '').slice(0, 120);
  if (!/^\d{4,20}$/.test(channelId)) {
    response.status(400).json({ error: '频道号格式不正确。' });
    return;
  }
  if (!videoKey.includes(':')) {
    response.status(400).json({ error: 'videoKey 格式应为「来源:视频ID」。' });
    return;
  }
  const time = Number(body.time);
  if (!Number.isFinite(time) || time < 0) {
    response.status(400).json({ error: '时间不正确。' });
    return;
  }

  const note = {
    id: String(body.id || `n-${Date.now()}`).slice(0, 80),
    channelId,
    videoKey,
    type: NOTE_TYPES.includes(body.type) ? body.type : 'key',
    time: Math.round(time),
    duration: Math.round(Number(body.duration) || 0),
    subtitle: String(body.subtitle || '').slice(0, 400),
    summary: String(body.summary || '').slice(0, 200),
    visitorId: String(body.visitorId || 'anon').slice(0, 64),
    createdAt: String(body.createdAt || new Date().toISOString()),
  };

  try {
    await appendNote(note);
    response.json({ ok: true, note });
  } catch (error) {
    console.error(`[second-note] 卡片入库失败: ${error.message}`);
    response.status(500).json({ error: '卡片暂存失败，但本地笔记不受影响。' });
  }
});

app.get('/api/notes/:channelId/:videoKey', async (request, response) => {
  const channelId = String(request.params.channelId);
  const videoKey = String(request.params.videoKey);
  try {
    const notes = await listNotes(channelId, videoKey);
    response.json({ channelId, videoKey, count: notes.length, notes });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

/* ---------------- 教师端聚合接口 ---------------- */

/**
 * 点播场次列表（教师端侧栏）——每一条点播视频 + 已收到的卡片数。
 * 顺序按创建时间**从早到晚**（课程顺序），点哪条就复盘哪条。
 */
app.get('/api/vod-sessions', async (request, response) => {
  const channelId = String(request.query.channelId || process.env.POLYV_DEMO_CHANNEL_ID || '');
  try {
    const vods = await fetchVodVideos({
      userid: process.env.POLYV_VOD_USERID,
      secretkey: process.env.POLYV_VOD_SECRETKEY,
      pageSize: Number(process.env.POLYV_VOD_PAGE_SIZE || 50),
    });
    const counts = await countNotesByVideo(channelId);
    const sessions = vods
      .map((item) => {
        const videoKey = `vod:${item.vid}`;
        const stat = counts.get(videoKey) ?? { cards: 0, viewers: 0 };
        return {
          videoKey,
          vid: item.vid,
          title: item.title,
          duration: item.duration,
          creationTime: item.creationTime,
          cards: stat.cards,
          viewers: stat.viewers,
        };
      })
      .sort((a, b) => String(a.creationTime).localeCompare(String(b.creationTime)));
    response.json({ channelId, count: sessions.length, sessions });
  } catch (error) {
    console.warn(`[second-note] 点播场次列表失败: ${error.message}`);
    response.status(500).json({ error: error.message });
  }
});

app.get('/api/teacher/:videoKey', async (request, response) => {
  const channelId = String(request.query.channelId || process.env.POLYV_DEMO_CHANNEL_ID || '');
  const videoKey = String(request.params.videoKey);
  const [, videoId] = videoKey.split(':');

  let notes = [];
  try {
    notes = await listNotes(channelId, videoKey);
  } catch (error) {
    response.status(500).json({ error: error.message });
    return;
  }

  let chapters = [];
  let title = '';
  let durationSec = 0;
  let jumpUrl = null;
  let sessionId = videoId;
  const credentials = getCredentials();

  // 点播视频：标题/时长从点播库拿（点播没有官方 AI 大纲，章节留空）
  if (videoKey.startsWith('vod:') && process.env.POLYV_VOD_USERID) {
    try {
      const vod = await fetchVodVideo(videoId, {
        userid: process.env.POLYV_VOD_USERID,
        secretkey: process.env.POLYV_VOD_SECRETKEY,
      });
      if (vod) {
        title = vod.title;
        durationSec = vod.duration;
        jumpUrl = vod.playUrl;
      }
    } catch (error) {
      console.warn(`[second-note] 点播信息不可用: ${error.message}`);
    }
  }

  if (credentials && videoId && !videoKey.startsWith('vod:')) {
    try {
      const files = await fetchRecordFiles(channelId, credentials);
      const file = files.find(
        (item) =>
          String(item.fileId) === videoId ||
          String(item.channelSessionId) === videoId,
      );
      if (file) {
        title = String(file.name || '');
        durationSec = Number(file.duration || 0);
        jumpUrl = resolveWatchUrl(file.watchUrl);
        // 用直播场次号做 sessionId，才能对上 data/teacher/ai/<sessionId>.json 里的离线解读
        sessionId = String(file.channelSessionId || videoId);
        if (file.outline?.outlineUrl && file.outline.status === 'success') {
          chapters = await fetchOutlineChapters(file.outline.outlineUrl, videoId);
        }
      }
    } catch (error) {
      console.warn(`[second-note] 教师端大纲不可用: ${error.message}`);
    }
  }

  const report = aggregate({
    notes,
    chapters,
    durationSec,
    title,
    videoKey,
    sessionId,
    jumpUrl,
  });
  response.json(report);
});

app.post('/api/transcript', async (request, response) => {
  try {
    const result = await transcribeMedia({
      sourceType: String(request.body?.sourceType || ''),
      videoId: String(request.body?.videoId || ''),
      mediaUrl: String(request.body?.mediaUrl || ''),
    });
    response.json({
      transcript: result.cues,
      transcriptSource: result.cues.length ? 'ai' : 'none',
      hasSpeech: result.hasSpeech,
      cached: result.cached,
      model: result.model,
    });
  } catch (error) {
    const status = error instanceof TranscriptServiceError ? error.status : 500;
    response.status(status).json({
      error:
        error instanceof Error ? error.message : '字幕识别服务暂时不可用。',
    });
  }
});

/* ---------------- 静态资源：观众端 / + 教师端 /teacher ---------------- */

/**
 * 把演示配置注入首页 —— 频道号由服务端 .env.local 决定，前端不再写死。
 * 这样换一场演示只要改环境变量，不用重新构建前端。
 */
function renderIndexHtml() {
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const config = {
    channelId: process.env.POLYV_DEMO_CHANNEL_ID || '',
    videoId: process.env.POLYV_DEMO_VIDEO_ID || '',
    source: process.env.POLYV_DEMO_SOURCE || '',
    teacherUrl: '/teacher',
  };
  return html.replace(
    '</head>',
    `<script>window.__SECOND_NOTE_CONFIG__=${JSON.stringify(config)}</script></head>`,
  );
}

app.get('/', (_request, response) => {
  try {
    // 首页每次都要拿新的注入配置与新的 asset 指纹，禁止缓存
    response.set('Cache-Control', 'no-store, must-revalidate');
    response.type('html').send(renderIndexHtml());
  } catch (error) {
    response.status(404).send(`观众端还没构建：npm run build（${error.message}）`);
  }
});

/** 教师端默认复盘哪条视频 —— 和观众端默认播放保持一致 */
function renderTeacherHtml() {
  const html = fs.readFileSync(path.join(dist, 'teacher', 'teacher.html'), 'utf8');
  const config = {
    channelId: process.env.POLYV_DEMO_CHANNEL_ID || '',
    videoKey: `${process.env.POLYV_DEMO_SOURCE || 'vod'}:${process.env.POLYV_DEMO_VIDEO_ID || ''}`,
  };
  return html.replace(
    '</head>',
    `<script>window.__TEACHER_CONFIG__=${JSON.stringify(config)}</script></head>`,
  );
}

app.get('/teacher', (_request, response) => {
  response.set('Cache-Control', 'no-store, must-revalidate');
  try {
    response.type('html').send(renderTeacherHtml());
  } catch {
    response.status(404).send('教师端还没构建：npm run build:teacher');
  }
});
app.use('/teacher', express.static(path.join(dist, 'teacher'), {
  setHeaders: (res, filePath) => {
    res.setHeader(
      'Cache-Control',
      /[\\/]assets[\\/]/.test(filePath) ? 'public, max-age=31536000, immutable' : 'no-store',
    );
  },
}));
app.use('/data', express.static(path.join(dist, 'data')));

app.use(
  express.static(dist, {
    setHeaders: (res, filePath) => {
      if (/[\\/]assets[\\/]/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-store, must-revalidate');
      }
    },
  }),
);
app.get('*', (request, response, next) => {
  if (request.path.startsWith('/api/')) {
    next();
    return;
  }
  try {
    response.set('Cache-Control', 'no-store, must-revalidate');
    response.type('html').send(renderIndexHtml());
  } catch {
    next();
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`[second-note] API listening on http://127.0.0.1:${port}`);
  console.log(`[second-note] 观众端 http://127.0.0.1:${port}/  教师端 http://127.0.0.1:${port}/teacher`);
});
