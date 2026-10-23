import { useEffect, useRef, useState } from 'react';
import { formatTime } from '../lib/time';
import type { SafeChannel, SafeVideo, VideoSourceType } from '../types';

type VideoSwitcherProps = {
  channel: SafeChannel;
  videos: SafeVideo[];
  onSelect: (video: SafeVideo) => void;
};

function ChevronIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="m5 3 7 5-7 5V3Z" />
    </svg>
  );
}

const categories: Array<{ id: VideoSourceType; label: string }> = [
  { id: 'record', label: '直播暂存' },
  { id: 'playback', label: '回放列表' },
  { id: 'vod', label: '点播列表' },
];

export function VideoSwitcher({ channel, videos, onSelect }: VideoSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<VideoSourceType>(channel.videoSourceType);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActiveTab(channel.videoSourceType);
  }, [channel.videoSourceType]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const bySource = (sourceType: VideoSourceType) =>
    videos.filter((video) => video.sourceType === sourceType);

  // 只显示真的有视频的分类：频道里没有直播暂存 / 回放时，就不出现那两个空标签
  const availableCategories = categories.filter((category) => bySource(category.id).length > 0);
  const tabs = availableCategories.length ? availableCategories : categories;
  const activeCategory = tabs.some((tab) => tab.id === activeTab) ? activeTab : tabs[0].id;
  const visibleVideos = bySource(activeCategory);

  return (
    <div className="video-switcher" ref={rootRef}>
      <span className="live-dot" />
      <button
        className={`video-switcher__trigger ${open ? 'is-open' : ''}`}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="video-switcher__label">
          <strong>{channel.videoTitle}</strong>
          <small>
            频道 {channel.channelId} · 共 {videos.length} 个视频
          </small>
        </span>
        <span className="video-switcher__chevron">
          <ChevronIcon />
        </span>
      </button>

      {open && (
        <div className="video-switcher__panel">
          <div className="video-switcher__panel-head">
            <div>
              <span className="eyebrow">COURSE VIDEOS</span>
              <strong>切换课程</strong>
            </div>
            <span>{String(videos.length).padStart(2, '0')}</span>
          </div>

          {tabs.length > 1 && (
            <div className="video-switcher__tabs" role="tablist" aria-label="视频分类">
              {tabs.map((category) => {
                const count = bySource(category.id).length;
                return (
                  <button
                    key={category.id}
                    className={activeCategory === category.id ? 'is-active' : ''}
                    type="button"
                    role="tab"
                    aria-selected={activeCategory === category.id}
                    onClick={() => setActiveTab(category.id)}
                  >
                    {category.label}
                    <span>{count}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="video-switcher__list" role="listbox" aria-label="频道点播列表">
            {visibleVideos.map((video) => {
              const active =
                video.sourceType === channel.videoSourceType &&
                video.videoId === channel.videoId;
              return (
                <button
                  key={video.videoId}
                  className={`video-option ${active ? 'is-active' : ''}`}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    setOpen(false);
                    if (!active) onSelect(video);
                  }}
                >
                  <span className="video-option__play">
                    <PlayIcon />
                  </span>
                  <span className="video-option__copy">
                    <strong>{video.title}</strong>
                    <small>
                      {formatTime(video.duration)}
                      {video.sourceType === 'record' && video.daysLeft
                        ? ` · 剩余 ${video.daysLeft} 天`
                        : ''}
                      {active ? ' · 正在播放' : ''}
                    </small>
                  </span>
                  {active && <span className="video-option__active">当前</span>}
                </button>
              );
            })}
            {visibleVideos.length === 0 && (
              <div className="video-switcher__empty">
                这个分类下暂时没有视频
              </div>
            )}
          </div>

          <p className="video-switcher__note">
            {tabs.length > 1
              ? '选择后会保留每条视频各自的秒记，不同分类之间互不影响。'
              : '选择后会保留每条视频各自的秒记。'}
          </p>
        </div>
      )}
    </div>
  );
}
