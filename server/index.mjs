import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchChannelBundle } from './polyv.mjs';
import { demoBundle } from './demoTranscript.mjs';
import {
  readCachedTranscript,
  transcribeMedia,
  TranscriptServiceError,
} from './transcript.mjs';

const app = express();
const port = Number(process.env.PORT || 8787);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const cache = new Map();

function getCredentials() {
  const appId = process.env.POLYV_APP_ID;
  const appSecret = process.env.POLYV_APP_SECRET;
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

app.get('/api/health', (_request, response) => {
  const credentials = getCredentials();
  response.json({
    ok: true,
    polyvConfigured: Boolean(credentials),
    channelId: process.env.POLYV_DEMO_CHANNEL_ID || '8569582',
  });
});

app.get('/api/channel/:channelId', async (request, response) => {
  const channelId = String(request.params.channelId);
  const requestedVideoId = String(request.query.vid || '');
  const requestedSource = String(request.query.source || '');
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
    const channelBundle = await fetchChannelBundle(
      channelId,
      credentials,
      requestedSource,
      requestedVideoId,
    );
    const cachedTranscript = await readCachedTranscript(
      channelBundle.channel.videoSourceType,
      channelBundle.channel.videoId,
    );
    const bundle = {
      ...channelBundle,
      transcript: cachedTranscript?.cues ?? [],
      transcriptSource: cachedTranscript?.cues?.length ? 'ai' : 'none',
    };
    cache.set(cacheKey, { createdAt: Date.now(), value: bundle });
    response.json(bundle);
  } catch (error) {
    console.error(`[second-note] Polyv request failed: ${error.message}`);
    response.json({ ...demoBundle, source: 'demo', reason: 'polyv-unavailable' });
  }
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

const dist = path.join(projectRoot, 'dist');
app.use(express.static(dist));
app.get('*', (request, response, next) => {
  if (request.path.startsWith('/api/')) {
    next();
    return;
  }
  response.sendFile(path.join(dist, 'index.html'), (error) => {
    if (error) next();
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`[second-note] API listening on http://127.0.0.1:${port}`);
});
