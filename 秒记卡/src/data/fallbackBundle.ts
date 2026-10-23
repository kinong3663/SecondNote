import type { ChannelBundle } from '../types';

export const fallbackBundle: ChannelBundle = {
  channel: {
    channelId: '8569582',
    name: '11',
    watchStatus: 'playback',
    watchStatusText: '回放中',
    watchUrl:
      'https://live.polyv.cn/watch/8569582?vid=77cb51cee7&playbackType=vod',
    videoId: '77cb51cee7',
    videoSourceType: 'vod',
    videoKey: 'vod:77cb51cee7',
    videoTitle: '民族团结视频',
    duration: 33,
    firstImage:
      'http://img.videocc.net/uimage/2/24d5456a9c/2/24d5456a9ccb0fdeb0516dde9961e522_0_b.jpg',
  },
  videos: [
    {
      videoId: '77cb51cee7',
      sourceType: 'vod',
      title: '民族团结视频',
      duration: 33,
      firstImage:
        'http://img.videocc.net/uimage/2/24d5456a9c/2/24d5456a9ccb0fdeb0516dde9961e522_0_b.jpg',
      watchUrl:
        'https://live.polyv.cn/watch/8569582?vid=77cb51cee7&playbackType=vod',
    },
  ],
  transcript: [],
  transcriptSource: 'none',
  source: 'demo',
  reason: 'offline-fallback',
};
