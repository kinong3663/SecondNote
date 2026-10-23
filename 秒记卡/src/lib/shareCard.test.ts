import { describe, expect, it } from 'vitest';
import { buildInterpolatedShareUrl } from './shareCard';

describe('share links', () => {
  it('preserves existing query parameters and adds the note time', () => {
    expect(
      buildInterpolatedShareUrl(
        'https://live.polyv.cn/watch/8569582?vid=77cb51cee7&playbackType=vod',
        18,
      ),
    ).toBe(
      'https://live.polyv.cn/watch/8569582?vid=77cb51cee7&playbackType=vod&t=18',
    );
  });
});
