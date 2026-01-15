export type VocabScore = {
  score: number;
};

export const scoreRoleVocab = (transcript: string, targetVocab: ReadonlyArray<string>): number => {
  if (targetVocab.length === 0) {
    return 0;
  }
  const normalized = transcript.toLowerCase();
  const matched = new Set(
    targetVocab.filter((vocab) => normalized.includes(vocab.toLowerCase()))
  );
  return Math.round((matched.size / targetVocab.length) * 100);
};
