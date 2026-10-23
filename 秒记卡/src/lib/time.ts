export function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remaining = safe % 60;
  const values = [minutes, remaining].map((value) => String(value).padStart(2, '0'));
  return hours > 0 ? `${String(hours).padStart(2, '0')}:${values.join(':')}` : values.join(':');
}

export function clampTime(seconds: number, duration: number): number {
  return Math.min(Math.max(seconds, 0), Math.max(duration, 0));
}

export function parseTimeLabel(label: string): number {
  return label
    .split(':')
    .map(Number)
    .reduce((total, part) => total * 60 + part, 0);
}
