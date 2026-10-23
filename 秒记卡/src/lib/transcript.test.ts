import { describe, expect, it } from 'vitest';
import { findNearbyCue, suggestSummary, type TranscriptCue } from './transcript';

const cues: TranscriptCue[] = [
  { start: 0, end: 4, text: '先理解问题的背景。' },
  { start: 5, end: 9, text: '再看一个具体案例。' },
  { start: 10, end: 15, text: '最后总结成三个步骤。' },
];

describe('transcript helpers', () => {
  it('finds a cue containing the current time', () => {
    expect(findNearbyCue(cues, 6)?.text).toBe('再看一个具体案例。');
  });

  it('finds the nearest cue within tolerance', () => {
    expect(findNearbyCue(cues, 9.6, 1)?.text).toBe('最后总结成三个步骤。');
    expect(findNearbyCue(cues, 30, 1)).toBeUndefined();
  });

  it('uses the title when no subtitle is available', () => {
    expect(suggestSummary([], 12, '民族团结视频')).toContain('民族团结视频');
  });
});
