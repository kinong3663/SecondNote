import { describe, expect, it } from 'vitest';
import {
  buildPolyvSign,
  buildVideoLibrary,
  buildVideoCatalog,
  resolveWatchUrl,
  sanitizeChannel,
} from './polyv.mjs';

describe('Polyv signing', () => {
  it('sorts all non-empty parameters and wraps the secret', () => {
    const params = { timestamp: '2', appId: 'abc', ignored: '' };
    expect(buildPolyvSign(params, 'secret')).toBe('1467BF32B2EC2851FF4FAB474C5B6579');
  });

  it('removes credentials and stream secrets', () => {
    const safe = sanitizeChannel({
      channelId: 8569582,
      name: '11',
      watchUrl: 'https://live.polyv.cn/watch/8569582',
      watchStatus: 'playback',
      watchStatusText: '回放中',
      pushSecret: 'never-expose',
      channelPasswd: 'never-expose',
    });
    expect(safe.channelId).toBe('8569582');
    expect(safe).not.toHaveProperty('pushSecret');
    expect(safe).not.toHaveProperty('channelPasswd');
  });

  it('resolves protocol-relative playback URLs', () => {
    expect(resolveWatchUrl('//live.polyv.cn/watch/8569582')).toBe(
      'https://live.polyv.cn/watch/8569582',
    );
  });

  it('lists every channel VOD and selects the requested video', () => {
    const catalog = buildVideoCatalog(
      [
        {
          videoId: 'video-a',
          title: '开场',
          duration: '00:00:30',
          firstImage: 'https://img.example/a.jpg',
          watchUrl: null,
          asDefault: 'Y',
        },
        {
          videoId: 'video-b',
          title: '案例课',
          duration: '00:02:05',
          firstImage: 'https://img.example/b.jpg',
          watchUrl: '//live.polyv.cn/watch/8569582?vid=video-b',
          asDefault: 'N',
        },
      ],
      'video-b',
      'https://live.polyv.cn/watch/8569582',
    );

    expect(catalog.videos.map((video) => video.videoId)).toEqual(['video-a', 'video-b']);
    expect(catalog.selected.title).toBe('案例课');
    expect(catalog.selected.duration).toBe(125);
    expect(catalog.selected.watchUrl).toBe(
      'https://live.polyv.cn/watch/8569582?vid=video-b&playbackType=vod',
    );
  });

  it('groups record, playback and VOD videos and keeps their source types', () => {
    const library = buildVideoLibrary(
      {
        records: [
          {
            fileId: 'record-a',
            name: '直播暂存 A',
            duration: 578,
            mp4: 'https://media.example/record-a.mp4',
            m3u8: '',
            channelSessionId: 'session-a',
            daysLeft: 165,
          },
        ],
        playbacks: [
          {
            videoId: 'playback-a',
            title: '直播回放 A',
            duration: '00:03:20',
            channelSessionId: 'session-b',
          },
        ],
        vods: [
          {
            videoId: 'vod-a',
            name: '点播 A',
            duration: '00:01:30',
            watchUrl: '//live.polyv.cn/watch/8569582?vid=vod-a',
          },
        ],
      },
      'record',
      'record-a',
      'https://live.polyv.cn/watch/8569582',
    );

    expect(library.videos.map((video) => video.sourceType)).toEqual([
      'record',
      'playback',
      'vod',
    ]);
    expect(library.selected.sourceType).toBe('record');
    expect(library.selected.fileId).toBe('record-a');
    expect(library.selected.daysLeft).toBe(165);
  });
});
