/**
 * Tiny publish/subscribe event bus.
 * Systems talk to each other through events instead of calling each other
 * directly, which keeps them independent and easy to extend.
 */
export class EventBus {
  constructor() {
    this.handlers = new Map();
  }

  /** Subscribe. Returns an unsubscribe function. */
  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    this.handlers.get(event)?.delete(fn);
  }

  emit(event, payload) {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const fn of [...set]) fn(payload);
  }

  clear() {
    this.handlers.clear();
  }
}
