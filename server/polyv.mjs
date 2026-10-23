import { createHash } from 'node:crypto';

const API_ORIGIN = 'https://api.polyv.net';

export function buildPolyvSign(params, appSecret) {
  const raw = Object.keys(params)
    .filter((key) => params[key] !== '' && params[key] != null)
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join('');

  return createHash('md5')
    .update(`${appSecret}${raw}${appSecret}`, 'utf8')
    .digest('hex')
    .toUpperCase();
}

export function sanitizeChannel(channel) {
  return {
    channelId: String(channel.channelId),
    name: String(channel.name ?? '未命名直播'),
    watchStatus: String(channel.watchStatus ?? 'unknown'),
    watchStatusText: String(channel.watchStatusText ?? '状态未知'),
    watchUrl: String(channel.watchUrl ?? ''),
  };
}

export function resolveWatchUrl(value) {
  if (value.startsWith('//')) return `https:${value}`;
  return value;
}

function createSignedParams(appId, appSecret, businessParams = {}) {
  const params = {
    ...businessParams,
    appId,
    timestamp: String(Date.now()),
  };
  params.sign = buildPolyvSign(params, appSecret);
  return params;
}

async function polyvGet(path, credentials, businessParams = {}) {
  const params = createSignedParams(
    credentials.appId,
    credentials.appSecret,
    businessParams,
  );
  const url = new URL(path, API_ORIGIN);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  });

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'SecondNote/0.1',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Polyv API returned HTTP ${response.status}`);
  }

  const data = await response.json();
  if (data.code !== 200) {
    throw new Error(data.message || data.error?.desc || 'Polyv API request failed');
  }
  return data;
}

function durationToSeconds(duration) {
  if (typeof duration === 'number') return duration;
  if (!duration || typeof duration !== 'string') return 0;
  return duration
    .split(':')
    .map(Number)
    .reduce((total, part) => total * 60 + part, 0);
}

function buildPlaybackUrl(channelWatchUrl, video) {
  const base = resolveWatchUrl(video.watchUrl || channelWatchUrl);
  if (!base) return '';
  const url = new URL(base);
  if (video.videoId) {
    url.searchParams.set('vid', String(video.videoId));
    url.searchParams.set('playbackType', 'vod');
  }
  return url.toString();
}

export function buildVideoCatalog(videos, requestedVideoId, channelWatchUrl) {
  const safeVideos = videos.map((video) => ({
    videoId: String(video.videoId || ''),
    sourceType: 'vod',
    title: String(video.title || '未命名点播'),
    duration: durationToSeconds(video.duration),
    firstImage: String(video.firstImage || ''),
    watchUrl: buildPlaybackUrl(channelWatchUrl, video),
  }));
  const selectedVideo =
    videos.find((video) => requestedVideoId && String(video.videoId) === requestedVideoId) ??
    videos.find((video) => video.asDefault === 'Y') ??
    videos[0];
  const selectedIndex = Math.max(0, videos.indexOf(selectedVideo));
  const selected = safeVideos[selectedIndex] ?? {
    videoId: '',
    title: '直播回放',
    duration: 0,
    firstImage: '',
    watchUrl: resolveWatchUrl(channelWatchUrl),
  };
  return { videos: safeVideos, selected };
}

function playbackUrl(channelWatchUrl, videoId) {
  const url = new URL(resolveWatchUrl(channelWatchUrl));
  url.searchParams.set('vid', videoId);
  url.searchParams.set('playbackType', 'vod');
  return url.toString();
}

export function buildVideoLibrary(
  { records = [], playbacks = [], vods = [] },
  requestedSource = '',
  requestedVideoId = '',
  channelWatchUrl = '',
) {
  const recordVideos = records.map((record) => ({
    videoId: String(record.fileId),
    sourceType: 'record',
    title: String(record.name || `直播暂存 ${record.startTime || ''}`.trim()),
    duration: Number(record.duration || 0),
    firstImage: String(record.firstImage || ''),
    watchUrl: resolveWatchUrl(channelWatchUrl),
    fileId: String(record.fileId),
    sessionId: String(record.channelSessionId || record.originSessionId || ''),
    mediaUrl: String(record.mp4 || record.m3u8 || record.fileUrl || ''),
    daysLeft: Number(record.daysLeft ?? 0),
  }));

  const playbackVideos = playbacks.map((video) => ({
    videoId: String(video.videoId),
    sourceType: 'playback',
    title: String(video.title || video.name || '直播回放'),
    duration: durationToSeconds(video.duration),
    firstImage: String(video.firstImage || ''),
    watchUrl: playbackUrl(channelWatchUrl, String(video.videoId)),
    fileId: video.fileId ? String(video.fileId) : undefined,
    sessionId: String(video.channelSessionId || ''),
  }));

  const vodVideos = vods.map((video) => ({
    videoId: String(video.videoId),
    sourceType: 'vod',
    title: String(video.name || video.title || '未命名点播'),
    duration: durationToSeconds(video.duration),
    firstImage: String(video.firstImage || ''),
    watchUrl: buildPlaybackUrl(channelWatchUrl, video),
  }));

  const videos = [...recordVideos, ...playbackVideos, ...vodVideos];
  const allowedSource = ['record', 'playback', 'vod'].includes(requestedSource)
    ? requestedSource
    : '';
  const selected =
    videos.find(
      (video) =>
        allowedSource === video.sourceType &&
        requestedVideoId &&
        video.videoId === requestedVideoId,
    ) ??
    videos.find((video) => allowedSource === video.sourceType) ??
    videos[0] ?? {
      videoId: '',
      sourceType: 'vod',
      title: '直播回放',
      duration: 0,
      firstImage: '',
      watchUrl: resolveWatchUrl(channelWatchUrl),
    };

  return { videos, selected };
}

export async function fetchChannelBundle(
  channelId,
  credentials,
  requestedSource = '',
  requestedVideoId = '',
) {
  const [channelResponse, recordsResponse, playbacksResponse, vodResponse, playbackSettings] = await Promise.all([
    polyvGet('/live/v4/channel/basic/get', credentials, { channelId }),
    polyvGet('/live/v4/channel/record-file/list', credentials, {
      channelId,
      pageNumber: '1',
      pageSize: '100',
    }),
    polyvGet('/live/v3/user/playback/list', credentials, {
      channelId,
      page: '1',
      pageSize: '100',
      listType: 'playback',
      order: 'timeDesc',
    }),
    polyvGet(
      '/live/v3/user/playback/list',
      credentials,
      { channelId, page: '1', pageSize: '100', listType: 'vod', order: 'timeDesc' },
    ),
    polyvGet('/live/v4/channel/playback/list', credentials, { channelIds: channelId }),
  ]);

  const channel = sanitizeChannel(channelResponse.data);
  const configured = playbackSettings.data?.find(
    (item) => String(item.channelId) === String(channelId),
  );
  const configuredVideos = configured?.videoList ?? [];
  const vodContents =
    configured?.origin === 'vod' && configuredVideos.length > 0
      ? configuredVideos
      : vodResponse.data?.contents ?? [];
  const defaultSource =
    requestedSource || (['record', 'playback', 'vod'].includes(configured?.origin) ? configured.origin : 'vod');
  const catalog = buildVideoLibrary(
    {
      records: recordsResponse.data?.contents ?? [],
      playbacks: playbacksResponse.data?.contents ?? [],
      vods: vodContents,
    },
    defaultSource,
    requestedVideoId,
    channel.watchUrl,
  );

  return {
    channel: {
      ...channel,
      watchUrl: catalog.selected.watchUrl,
      videoId: catalog.selected.videoId,
      videoSourceType: catalog.selected.sourceType,
      videoKey: `${catalog.selected.sourceType}:${catalog.selected.videoId}`,
      videoTitle: catalog.selected.title,
      duration: catalog.selected.duration,
      firstImage: catalog.selected.firstImage,
    },
    videos: catalog.videos,
    source: 'polyv',
  };
}
