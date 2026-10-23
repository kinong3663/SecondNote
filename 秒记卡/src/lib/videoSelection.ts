import type { ChannelBundle, SafeVideo } from '../types';

export function videoKey(video: Pick<SafeVideo, 'sourceType' | 'videoId'>): string {
  return `${video.sourceType}:${video.videoId}`;
}

export function applySelectedVideo(
  bundle: ChannelBundle,
  video: SafeVideo,
): ChannelBundle {
  return {
    ...bundle,
    transcript: [],
    transcriptSource: 'none',
    channel: {
      ...bundle.channel,
      videoId: video.videoId,
      videoSourceType: video.sourceType,
      videoKey: videoKey(video),
      videoTitle: video.title,
      duration: video.duration,
      firstImage: video.firstImage,
      watchUrl: video.watchUrl,
    },
  };
}
