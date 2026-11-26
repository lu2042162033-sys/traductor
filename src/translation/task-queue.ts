interface QueueEntry {
  run: () => Promise<void>;
  reject: (error: unknown) => void;
}

export class TaskQueue {
  private readonly pending: QueueEntry[] = [];
  private activeCount = 0;

  constructor(
    private readonly concurrency = 2,
    private readonly onStateChange?: (state: {
      active: number;
      pending: number;
    }) => void,
  ) {}

  enqueue(run: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pending.push({
        run: async () => {
          try {
            await run();
            resolve();
          } catch (error) {
            reject(error);
          }
        },
        reject,
      });
      this.pump();
    });
  }

  private pump(): void {
    while (
      this.activeCount < this.concurrency &&
      this.pending.length > 0
    ) {
      const entry = this.pending.shift();
      if (!entry) {
        break;
      }

      this.activeCount += 1;
      this.notify();
      void entry
        .run()
        .catch(entry.reject)
        .finally(() => {
          this.activeCount -= 1;
          this.notify();
          this.pump();
        });
    }
  }

  private notify(): void {
    this.onStateChange?.({
      active: this.activeCount,
      pending: this.pending.length,
    });
  }
}
