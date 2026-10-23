import { describe, expect, it } from 'vitest';
import { clampTime, formatTime, parseTimeLabel } from './time';

describe('time utilities', () => {
  it('formats short and long durations', () => {
    expect(formatTime(65)).toBe('01:05');
    expect(formatTime(3723)).toBe('01:02:03');
  });

  it('clamps a requested seek time', () => {
    expect(clampTime(-2, 33)).toBe(0);
    expect(clampTime(42, 33)).toBe(33);
    expect(clampTime(12.8, 33)).toBe(12.8);
  });

  it('round-trips a time label', () => {
    expect(parseTimeLabel('01:02:03')).toBe(3723);
    expect(parseTimeLabel('01:05')).toBe(65);
  });
});
