import { describe, expect, it } from 'vitest';
import { fallbackBundle } from './fallbackBundle';

describe('fallback transcript', () => {
  it('never ships invented subtitles when ASR is unavailable', () => {
    expect(fallbackBundle.transcript).toEqual([]);
    expect(fallbackBundle.transcriptSource).toBe('none');
  });
});
