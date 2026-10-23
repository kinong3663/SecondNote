import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import type { Note } from '../lib/notes';
import {
  buildInterpolatedShareUrl,
  drawShareCard,
  type ShareCardData,
} from '../lib/shareCard';
import { formatTime } from '../lib/time';
import type { SafeChannel } from '../types';

type ShareCardDialogProps = {
  note: Note;
  channel: SafeChannel;
  onClose: () => void;
};

export function ShareCardDialog({ note, channel, onClose }: ShareCardDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [preview, setPreview] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [status, setStatus] = useState('正在生成分享卡…');

  useEffect(() => {
    let cancelled = false;

    async function createCard() {
      const url = buildInterpolatedShareUrl(window.location.href, note.time);
      setShareUrl(url);

      const qrDataUrl = await QRCode.toDataURL(url, {
        width: 480,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#08100e', light: '#f7f6f1' },
      });

      const data: ShareCardData = {
        channelName: channel.name,
        videoTitle: channel.videoTitle,
        summary: note.summary,
        subtitle: note.subtitle || '在此刻留下自己的理解。',
        timeLabel: formatTime(note.time),
        qrDataUrl,
      };

      if (canvasRef.current) {
        await drawShareCard(canvasRef.current, data);
        if (!cancelled) {
          setPreview(canvasRef.current.toDataURL('image/png'));
          setStatus('');
        }
      }
    }

    createCard().catch((error) => {
      if (!cancelled) setStatus(error instanceof Error ? error.message : '分享卡生成失败');
    });

    return () => {
      cancelled = true;
    };
  }, [channel, note]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [onClose]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setStatus('回看链接已复制');
    } catch {
      setStatus('复制失败，请手动选择链接');
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="share-dialog__header">
          <div>
            <span className="eyebrow">TAKE THIS MOMENT</span>
            <h2 id="share-dialog-title">带走这一刻</h2>
          </div>
          <button className="dialog-close" type="button" onClick={onClose} aria-label="关闭分享卡">
            ×
          </button>
        </div>

        <div className="share-preview">
          {preview ? <img src={preview} alt={`${formatTime(note.time)} 的秒记分享卡`} /> : <div className="share-loading" />}
        </div>

        {status && <p className="dialog-status" role="status">{status}</p>}

        <div className="share-actions">
          <button className="text-button" type="button" onClick={copyLink} disabled={!shareUrl}>
            复制回看链接
          </button>
          {preview ? (
            <a className="primary-button" href={preview} download={`秒记卡-${formatTime(note.time).replaceAll(':', '-')}.png`}>
              下载分享卡
            </a>
          ) : (
            <button className="primary-button" type="button" disabled>
              正在生成
            </button>
          )}
        </div>
        <canvas ref={canvasRef} hidden />
      </section>
    </div>
  );
}
