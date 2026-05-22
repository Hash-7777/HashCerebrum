// Typed event bus. Single global instance (`bus`). One subscriber list
// per event name. No wildcards by design — wildcards make refactors brittle.

import type { EventMap } from './events';

type Handler<K extends keyof EventMap> = (payload: EventMap[K]) => void;
type AnyHandler = (payload: unknown) => void;

class EventBus {
  private handlers = new Map<keyof EventMap, Set<AnyHandler>>();

  on<K extends keyof EventMap>(event: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as AnyHandler);
    return () => set!.delete(handler as AnyHandler);
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of set) {
      try {
        (h as Handler<K>)(payload);
      } catch (e) {
        console.error(`EventBus handler for ${String(event)} threw:`, e);
      }
    }
  }
}

export const bus = new EventBus();
