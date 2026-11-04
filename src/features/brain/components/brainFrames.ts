// A tiny broadcast of "the brain canvas just drew a frame". The canvas renders
// on demand when idle, so anything that follows the 3D scene from outside it
// (the region label overlay) can update exactly when the picture changes —
// camera moved, brain rotated, canvas resized — and do nothing at all while the
// scene is still, instead of measuring the page sixty times a second.

type FrameListener = () => void;

const listeners = new Set<FrameListener>();

/** Subscribe to rendered brain frames. Returns the unsubscribe function. */
export function onBrainFrame(listener: FrameListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called by the canvas once per rendered frame. */
export function emitBrainFrame(): void {
  for (const listener of listeners) listener();
}
