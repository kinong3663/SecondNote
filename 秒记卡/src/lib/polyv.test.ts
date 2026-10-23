import { describe, expect, it, vi } from 'vitest';
import { resolvePlaybackTarget, seekSafely, seekWhenReady } from './polyv';

describe('seekSafely', () => {
  it('clamps requested times and calls the player once', () => {
    const seekVideo = vi.fn();
    seekSafely({ seekVideo }, 40, 33);
    expect(seekVideo).toHaveBeenCalledWith(33);
  });

  it('retries while the player is not ready', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const seekVideo = vi.fn(() => {
      attempts += 1;
      if (attempts < 3) throw new Error('metadata not ready');
    });

    const result = seekWhenReady({ seekVideo }, 12, 33, { attempts: 3, delayMs: 10 });
    await vi.runAllTimersAsync();

    await expect(result).resolves.toBe(true);
    expect(seekVideo).toHaveBeenCalledTimes(3);
    expect(seekVideo).toHaveBeenLastCalledWith(12);
    vi.useRealTimers();
  });
});

describe('resolvePlaybackTarget', () => {
  it('loads the selected VOD instead of the channel default target', async () => {
    const selectedTarget = { playbackId: '72a7ce8a10' };
    const getPlaybackTargetById = vi.fn().mockResolvedValue(selectedTarget);
    const getSinglePlaybackTarget = vi.fn().mockReturnValue({ playbackId: 'default' });

    const target = await resolvePlaybackTarget(
      {
        getPlaybackTargetById,
        getSinglePlaybackTarget,
      },
      { sourceType: 'vod', videoId: '72a7ce8a10' },
    );

    expect(target).toBe(selectedTarget);
    expect(getPlaybackTargetById).toHaveBeenCalledWith({ playbackId: '72a7ce8a10' });
    expect(getSinglePlaybackTarget).not.toHaveBeenCalled();
  });
});
