/**
 * A simple async semaphore for limiting concurrency.
 * Used to bound the number of concurrent Playwright page renders
 * so the browser process doesn't get overwhelmed.
 */
export class Semaphore {
  private available: number;
  private waiters: Array<() => void> = [];

  constructor(private readonly max: number) {
    this.available = max;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.available -= 1;
        resolve();
      });
    });
  }

  release(): void {
    this.available += 1;
    const next = this.waiters.shift();
    if (next) {
      // The waiter will decrement available in its own callback.
      this.available -= 1;
      next();
    }
  }

  get current(): number {
    return this.max - this.available;
  }

  get capacity(): number {
    return this.max;
  }
}

/**
 * Run a list of async tasks with a bounded concurrency limit.
 * Preserves the order of results to match the input order.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const sem = new Semaphore(limit);
  const tasks = items.map(async (item, index) => {
    await sem.acquire();
    try {
      results[index] = await worker(item, index);
    } finally {
      sem.release();
    }
  });
  await Promise.all(tasks);
  return results;
}
