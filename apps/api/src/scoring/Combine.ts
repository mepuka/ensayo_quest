export type CombinedScore = {
  overall: number;
};

export type Subscores = {
  fluency: number;
  vocab: number;
  grammar: number;
  relevance: number;
  pronunciation: number;
  naturalness: number;
};

export const combineScores = (scores: Subscores): number => {
  const values = Object.values(scores);
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round(total / values.length);
};
