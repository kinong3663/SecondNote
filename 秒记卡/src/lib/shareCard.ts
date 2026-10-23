export type ShareCardData = {
  channelName: string;
  videoTitle: string;
  summary: string;
  subtitle: string;
  timeLabel: string;
  qrDataUrl: string;
};

export function buildInterpolatedShareUrl(channelUrl: string, time: number): string {
  const url = new URL(channelUrl);
  url.searchParams.set('t', String(Math.max(0, Math.floor(time))));
  return url.toString();
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  let line = '';

  for (const character of text) {
    const next = line + character;
    if (context.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = character;
    } else {
      line = next;
    }
  }

  if (line) lines.push(line);
  return lines;
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const lines = wrapText(context, text, maxWidth);
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines) visible[maxLines - 1] = `${visible[maxLines - 1].slice(0, -1)}…`;
  visible.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
  return y + visible.length * lineHeight;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('二维码图片加载失败'));
    image.src = source;
  });
}

export async function drawShareCard(
  canvas: HTMLCanvasElement,
  data: ShareCardData,
): Promise<void> {
  const width = 1080;
  const height = 1440;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器不支持 Canvas');

  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, '#f8fbff');
  background.addColorStop(0.58, '#eef5ff');
  background.addColorStop(1, '#e4efff');
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = 'rgba(36, 105, 243, 0.13)';
  context.lineWidth = 2;
  for (let radius = 180; radius <= 640; radius += 76) {
    context.beginPath();
    context.arc(width - 72, 30, radius, 0, Math.PI * 2);
    context.stroke();
  }

  context.fillStyle = 'rgba(65, 132, 255, 0.16)';
  context.beginPath();
  context.arc(922, 158, 118, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#2469f3';
  context.beginPath();
  context.arc(922, 158, 13, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = '#2469f3';
  roundedRect(context, 74, 72, 176, 50, 25);
  context.fill();
  context.fillStyle = '#ffffff';
  context.font = '600 24px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText('秒记卡 · 01', 98, 106);

  context.fillStyle = 'rgba(41, 73, 126, 0.68)';
  context.font = '500 24px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText(data.channelName.toUpperCase(), 74, 190);

  context.fillStyle = '#11244a';
  context.font = '700 58px "PingFang SC", "Microsoft YaHei", sans-serif';
  drawWrappedText(context, data.videoTitle, 74, 284, 760, 76, 2);

  context.fillStyle = 'rgba(41, 73, 126, 0.7)';
  context.font = '500 24px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText(`记于 ${data.timeLabel}`, 74, 452);

  context.fillStyle = 'rgba(255, 255, 255, 0.78)';
  roundedRect(context, 74, 510, 932, 480, 38);
  context.fill();
  context.strokeStyle = 'rgba(36, 105, 243, 0.13)';
  context.stroke();

  context.fillStyle = '#2469f3';
  context.font = '600 26px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText('这一刻的重点', 122, 582);

  context.fillStyle = '#11244a';
  context.font = '600 48px "PingFang SC", "Microsoft YaHei", sans-serif';
  const summaryBottom = drawWrappedText(
    context,
    data.summary,
    122,
    674,
    780,
    68,
    4,
  );

  context.fillStyle = 'rgba(41, 73, 126, 0.68)';
  context.font = '400 25px "PingFang SC", "Microsoft YaHei", sans-serif';
  drawWrappedText(context, `“${data.subtitle}”`, 122, Math.max(summaryBottom + 42, 862), 780, 42, 3);

  const qr = await loadImage(data.qrDataUrl);
  context.fillStyle = '#f7f6f1';
  roundedRect(context, 74, 1040, 300, 300, 26);
  context.fill();
  context.drawImage(qr, 94, 1060, 260, 260);

  context.fillStyle = '#11244a';
  context.font = '600 31px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText('扫码回到这一秒', 416, 1110);
  context.fillStyle = 'rgba(41, 73, 126, 0.66)';
  context.font = '400 24px "PingFang SC", "Microsoft YaHei", sans-serif';
  drawWrappedText(
    context,
    '一节课很长，但真正值得带走的内容，可能只有几秒。',
    416,
    1168,
    520,
    38,
    3,
  );

  context.strokeStyle = 'rgba(36, 105, 243, 0.14)';
  context.beginPath();
  context.moveTo(74, 1360);
  context.lineTo(1006, 1360);
  context.stroke();
  context.fillStyle = 'rgba(56, 87, 140, 0.52)';
  context.font = '500 21px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText('POLYV · SECOND NOTE', 74, 1401);
  context.textAlign = 'right';
  context.fillText('让每一秒重点都有回音', 1006, 1401);
  context.textAlign = 'left';
}
