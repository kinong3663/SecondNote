import { clampTime } from './time';
import type { VideoSourceType } from '../types';

export interface PolyvPlayerController {
  seekVideo: (time: number) => void;
  getCurrentTime?: () => number;
  getDurationTime?: () => number;
}

export interface PlayerTime {
  currentTime: number;
  durationTime: number;
}

type PlaybackTargetLike = { playbackOptions?: unknown };

export async function resolvePlaybackTarget<T extends PlaybackTargetLike>(
  playback: {
    getPlaybackTargetById?: (options: {
      playbackId: string;
    }) => Promise<T | undefined>;
    getSinglePlaybackTarget?: () => T | undefined;
  },
  video: { sourceType: VideoSourceType; videoId: string },
): Promise<T | undefined> {
  if (
    video.videoId &&
    (video.sourceType === 'vod' || video.sourceType === 'playback') &&
    playback.getPlaybackTargetById
  ) {
    return playback.getPlaybackTargetById({ playbackId: video.videoId });
  }

  return playback.getSinglePlaybackTarget?.();
}

export function seekSafely(
  player: PolyvPlayerController,
  requestedTime: number,
  duration: number,
): void {
  player.seekVideo(clampTime(requestedTime, duration));
}

export async function seekWhenReady(
  player: PolyvPlayerController,
  requestedTime: number,
  duration: number,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<boolean> {
  const attempts = options.attempts ?? 10;
  const delayMs = options.delayMs ?? 150;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      seekSafely(player, requestedTime, duration);
      return true;
    } catch {
      if (attempt === attempts - 1) return false;
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }
  }

  return false;
}
