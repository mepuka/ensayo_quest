export const appendAudioBuffer = (
  current: Float32Array<ArrayBufferLike>,
  next: Float32Array<ArrayBufferLike>
) => {
  if (current.length === 0) {
    return next;
  }
  if (next.length === 0) {
    return current;
  }
  const combined = new Float32Array(current.length + next.length);
  combined.set(current, 0);
  combined.set(next, current.length);
  return combined;
};
