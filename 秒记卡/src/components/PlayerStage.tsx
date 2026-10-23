import { useEffect, useRef, useState } from 'react';
import type { PolyvWatchCore, SetupPlayerPlaybackOptions } from '@polyv/live-watch-sdk';
import type { PlayerTime, PolyvPlayerController } from '../lib/polyv';
import { resolvePlaybackTarget } from '../lib/polyv';
import { clampTime } from '../lib/time';
import type { SafeVideo } from '../types';

type PlayerStageProps = {
  channelId: string;
  video: SafeVideo;
  onTimeChange: (time: PlayerTime) => void;
  onPlayerReady: (player: PolyvPlayerController | null) => void;
};

export function PlayerStage({
  channelId,
  video,
  onTimeChange,
  onPlayerReady,
}: PlayerStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nativeVideoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  // 有直链（录制 mp4 / 点播 mp4）就用原生 <video>：不经过观看 SDK，也就没有频道授权限制
  const useNativePlayer = Boolean(video.mediaUrl);

  useEffect(() => {
    if (!useNativePlayer) return;
    const element = nativeVideoRef.current;
    if (!element) return;

    let disposed = false;
    setStatus('loading');
    setError('');

    const syncTime = () => {
      if (disposed) return;
      onTimeChange({
        currentTime: element.currentTime,
        durationTime: Number.isFinite(element.duration) ? element.duration : video.duration,
      });
    };
    const markReady = () => {
      if (disposed) return;
      onPlayerReady({
        seekVideo: (time) => {
          element.currentTime = clampTime(time, video.duration);
        },
        getCurrentTime: () => element.currentTime,
        getDurationTime: () => element.duration,
      });
      syncTime();
      setStatus('ready');
    };
    const markError = () => {
      if (disposed) return;
      setError('暂存视频加载失败，可能已过期或暂时不可用。');
      setStatus('error');
    };

    element.addEventListener('loadedmetadata', markReady);
    element.addEventListener('timeupdate', syncTime);
    element.addEventListener('durationchange', syncTime);
    element.addEventListener('error', markError);
    if (element.readyState >= 1) markReady();

    return () => {
      disposed = true;
      onPlayerReady(null);
      element.removeEventListener('loadedmetadata', markReady);
      element.removeEventListener('timeupdate', syncTime);
      element.removeEventListener('durationchange', syncTime);
      element.removeEventListener('error', markError);
    };
  }, [onPlayerReady, onTimeChange, video.duration, video.mediaUrl, useNativePlayer]);

  useEffect(() => {
    if (useNativePlayer) return;
    let disposed = false;
    let core: PolyvWatchCore | null = null;

    async function setupPlayer() {
      if (!containerRef.current) return;
      setStatus('loading');
      setError('');

      try {
        const sdk = await import('@polyv/live-watch-sdk');
        if (disposed || !containerRef.current) return;

        core = sdk.createWatchCore(
          {
            channelId,
            vid:
              video.sourceType === 'record' ? undefined : video.videoId || undefined,
            playbackOrigin:
              video.sourceType === 'record' ? undefined : video.sourceType,
          },
          { multiEnable: true },
        );

        await core.setup();
        if (!core.auth.isAuthorized()) {
          const result = await core.auth.verifyNoneAuth();
          if (!result.success) {
            // 频道开了「观看条件」（手机号 / 白名单 / 密码）时，匿名嵌入播放器拿不到观看凭证。
            // 视频没挂进本频道播放列表时，观看页也解析不到它 —— 两种情况都会走到这里。
            // SDK 只会给一句 "Unknown"，这里翻译成能动手改的提示。
            throw new Error(
              `播放器没能连上，两个常见原因：① 频道还开着「观看条件」（手机号/白名单），` +
                `匿名嵌入播放器拿不到观看凭证；② 这条视频没有加入该频道的播放列表，观看页解析不到它。` +
                `请到保利威后台「频道设置 → 观看条件 / 点播列表」确认。（SDK 原始原因：${result.failReason || 'none-auth 校验失败'}）`,
            );
          }
          await core.setup();
        }

        await core.connect();
        const target = await resolvePlaybackTarget(core.playback, video);
        const playbackOptions: SetupPlayerPlaybackOptions | undefined =
          video.sourceType === 'record'
            ? {
                type: sdk.PlaybackType.Record,
                fileId: video.fileId || video.videoId,
                duration: video.duration * 1000,
                sessionId: video.sessionId || '',
                videoSource: {
                  mp4: video.mediaUrl?.includes('.m3u8') ? null : video.mediaUrl || null,
                  m3u8: video.mediaUrl?.includes('.m3u8') ? video.mediaUrl : null,
                },
              }
            : (target?.playbackOptions as SetupPlayerPlaybackOptions | undefined);
        await core.player.setupPlayer({
          container: containerRef.current,
          playbackOptions,
          autoplay: false,
          showController: true,
          banHeaderAdvertisement: true,
        });

        core.player.eventEmitter.on(
          sdk.PlayerEvents.TimeUpdate,
          ({ currentTime, durationTime }: PlayerTime) => {
            if (!disposed) onTimeChange({ currentTime, durationTime });
          },
        );

        onPlayerReady(core.player as unknown as PolyvPlayerController);
        if (!disposed) setStatus('ready');
      } catch (setupError) {
        // 保利威 SDK 的报错往往只有一句 "Unknown"，把原始对象也吐到控制台便于排查
        console.error('[second-note] 播放器初始化失败', setupError);
        const message =
          setupError instanceof Error ? setupError.message : '播放器初始化失败。';
        if (!disposed) {
          setError(message);
          setStatus('error');
        }
      }
    }

    setupPlayer();
    return () => {
      disposed = true;
      onPlayerReady(null);
      try {
        core?.destroy?.();
      } catch {
        // The SDK may already have removed its singletons during hot reload.
      }
    };
  }, [channelId, video.fileId, video.mediaUrl, video.sessionId, video.sourceType, video.videoId]);

  return (
    <div className={`player-stage player-stage--${status}`}>
      <div ref={containerRef} className="player-host">
        {useNativePlayer && (
          <video
            ref={nativeVideoRef}
            className="record-video"
            src={video.mediaUrl}
            controls
            playsInline
            preload="metadata"
          />
        )}
      </div>
      {status !== 'ready' && (
        <div className="player-status" role={status === 'error' ? 'alert' : 'status'}>
          <span className="player-status__mark">{status === 'error' ? '!' : '·'}</span>
          <div>
            <strong>
              {status === 'error'
                ? '播放器没有成功连接'
                : useNativePlayer
                  ? '正在加载视频'
                  : '正在连接保利威回放'}
            </strong>
            <p>
              {status === 'error'
                ? error
                : useNativePlayer
                  ? '读取视频直链与时长…'
                  : '加载官方观看 SDK 和频道信息…'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
