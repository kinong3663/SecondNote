import { describe, expect, it } from 'vitest';
import { applySelectedVideo } from './videoSelection';
import type { ChannelBundle, SafeVideo } from '../types';

const video: SafeVideo = {
  videoId: 'video-b',
  sourceType: 'record',
  title: '案例课',
  duration: 125,
  firstImage: '',
  watchUrl: 'https://live.polyv.cn/watch/8569582?vid=video-b',
};

describe('selected video', () => {
  it('updates the active channel video and duration', () => {
    const bundle: ChannelBundle = {
      channel: {
        channelId: '8569582',
        name: '11',
        watchStatus: 'playback',
        watchStatusText: '回放中',
        watchUrl: 'https://live.polyv.cn/watch/8569582?vid=video-a',
        videoId: 'video-a',
        videoTitle: '开场',
        duration: 30,
        firstImage: '',
        videoSourceType: 'vod',
        videoKey: 'vod:video-a',
      },
      videos: [],
      transcript: [{ start: 0, end: 2, text: '上一条视频的字幕' }],
      transcriptSource: 'ai',
      source: 'polyv',
    };

    const next = applySelectedVideo(bundle, video);
    expect(next.channel.videoId).toBe('video-b');
    expect(next.channel.videoTitle).toBe('案例课');
    expect(next.channel.duration).toBe(125);
    expect(next.channel.videoSourceType).toBe('record');
    expect(next.channel.videoKey).toBe('record:video-b');
    expect(next.channel.watchUrl).toBe(video.watchUrl);
    expect(next.transcript).toEqual([]);
    expect(next.transcriptSource).toBe('none');
  });
});
