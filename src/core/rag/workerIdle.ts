// Each on-device model (embeddings, re-ranking, fact-check) runs in its own Web
// Worker, and each worker carries its own copy of the inference runtime and the
// model weights. Kept alive for the whole session, they hold that memory long
// after the last search — on a small machine, or beside a local model that
// needs the memory, that is the difference between running and swapping.
//
// A model worker is therefore released after a quiet spell and recreated on the
// next request. The first request after a release waits for the model to load
// again (a second or two); every request inside the window is unaffected.

/** How long a model worker may sit unused before it is released. */
export const MODEL_WORKER_IDLE_MS = 120_000;

/** Calls `onIdle` once `ms` pass after the last `arm()` with no `hold()` in between. */
export class IdleReaper {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ms: number,
    private readonly onIdle: () => void,
  ) {}

  /** Work is starting or in flight: cancel any pending release. */
  hold(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** The worker has gone quiet: start the countdown to release it. */
  arm(): void {
    this.hold();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onIdle();
    }, this.ms);
  }
}
