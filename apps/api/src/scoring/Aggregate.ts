export const aggregateQuestScore = (turnScores: Array<number>): number => {
  if (turnScores.length === 0) {
    return 0;
  }
  const total = turnScores.reduce((sum, score) => sum + score, 0);
  return Math.round(total / turnScores.length);
};
