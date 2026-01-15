export type AudioStats = {
  totalMs: number;
  speechMs: number;
  silenceMs: number;
  segments: Array<{ startMs: number; endMs: number }>;
};

export const scoreFluency = (stats: AudioStats, _transcript: string): number => {
  const ratio = stats.totalMs === 0 ? 0 : stats.speechMs / stats.totalMs;
  return Math.max(0, Math.min(100, Math.round(60 + ratio * 40)));
};
