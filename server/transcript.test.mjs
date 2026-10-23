import { describe, expect, it } from 'vitest';
import {
  isAllowedMediaUrl,
  normalizeWhisperSegments,
  transcriptCacheKey,
} from './transcript.mjs';

describe('transcript service', () => {
  it('accepts Polyv media CDN URLs and rejects arbitrary hosts', () => {
    expect(
      isAllowedMediaUrl(
        'https://playback-tc.videocc.net/polyvlive/demo/f0.mp4',
      ),
    ).toBe(true);
    expect(isAllowedMediaUrl('https://127.0.0.1/private.mp4')).toBe(false);
    expect(isAllowedMediaUrl('file:///C:/private.mp4')).toBe(false);
  });

  it('normalizes whisper timestamps into transcript cues', () => {
    expect(
      normalizeWhisperSegments([
        { start: 0, end: 2.34, text: ' 第一句。 ' },
        { start: 2.8, end: 5, text: '\n第二句。' },
      ]),
    ).toEqual([
      { start: 0, end: 2.34, text: '第一句。' },
      { start: 2.8, end: 5, text: '第二句。' },
    ]);
  });

  it('separates transcript caches by source type', () => {
    expect(transcriptCacheKey('record', 'abc')).not.toBe(
      transcriptCacheKey('vod', 'abc'),
    );
  });
});
