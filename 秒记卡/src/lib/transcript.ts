export type TranscriptCue = {
  start: number;
  end: number;
  text: string;
};

export function findNearbyCue(
  cues: TranscriptCue[],
  currentTime: number,
  tolerance = 2.5,
): TranscriptCue | undefined {
  return cues
    .map((cue) => ({
      cue,
      distance:
        currentTime >= cue.start && currentTime <= cue.end
          ? 0
          : Math.min(Math.abs(currentTime - cue.start), Math.abs(currentTime - cue.end)),
    }))
    .filter((item) => item.distance <= tolerance)
    .sort((a, b) => a.distance - b.distance)[0]?.cue;
}

export function suggestSummary(
  cues: TranscriptCue[],
  currentTime: number,
  fallbackTitle: string,
): string {
  const cue = findNearbyCue(cues, currentTime, 4);
  if (!cue) return `回看「${fallbackTitle}」中的重点内容。`;

  const concise = cue.text.replace(/[。！？!?]+$/g, '').trim();
  return concise.length <= 28 ? concise : `${concise.slice(0, 27)}…`;
}
