import type { TranscriptCue } from './lib/transcript';

export type VideoSourceType = 'record' | 'playback' | 'vod';

export type SafeChannel = {
  channelId: string;
  name: string;
  watchStatus: string;
  watchStatusText: string;
  watchUrl: string;
  videoId: string;
  videoSourceType: VideoSourceType;
  videoKey: string;
  videoTitle: string;
  duration: number;
  firstImage: string;
};

export type SafeVideo = {
  videoId: string;
  sourceType: VideoSourceType;
  title: string;
  duration: number;
  firstImage: string;
  watchUrl: string;
  fileId?: string;
  sessionId?: string;
  mediaUrl?: string;
  daysLeft?: number;
};

export type ChapterMark = {
  title: string;
  start: number;
  end: number;
  summary?: string[];
};

export type ChannelBundle = {
  channel: SafeChannel;
  videos: SafeVideo[];
  transcript: TranscriptCue[];
  transcriptSource: 'polyv' | 'ai' | 'none';
  /** 官方 AI 大纲章节（录制文件才有） */
  chapters?: ChapterMark[];
  source: 'polyv' | 'demo';
  reason?: string;
};
