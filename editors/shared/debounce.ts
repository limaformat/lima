/** Debounces independent callbacks by key. */
export class KeyedDebouncer<Key> {
  private readonly timers = new Map<Key, ReturnType<typeof setTimeout>>();

  constructor(private readonly delayMs: number) {}

  schedule(key: Key, run: () => void): void {
    this.cancel(key);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        run();
      }, this.delayMs),
    );
  }

  cancel(key: Key): void {
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
  }

  disposeAll(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
