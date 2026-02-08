/**
 * Generic Web Worker pool with task queue and Promise-based API.
 *
 * Features:
 * - Configurable worker count (defaults to hardwareConcurrency - 1)
 * - Task queue with round-robin assignment
 * - Promise-based execute(): pool.execute(data) => Promise<result>
 * - Graceful shutdown with pool.terminate()
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingTask<TResult> {
  resolve: (result: TResult) => void;
  reject: (error: Error) => void;
}

interface WorkerEntry<TResult> {
  worker: Worker;
  busy: boolean;
  currentTask: PendingTask<TResult> | null;
}

interface QueuedTask<TData, TResult> {
  data: TData;
  pending: PendingTask<TResult>;
}

// ---------------------------------------------------------------------------
// WorkerPool
// ---------------------------------------------------------------------------

export class WorkerPool<TData = any, TResult = any> {
  private readonly workers: Array<WorkerEntry<TResult>> = [];
  private readonly queue: Array<QueuedTask<TData, TResult>> = [];
  private nextWorker = 0;
  private terminated = false;

  /**
   * Create a worker pool.
   *
   * @param createWorker - Factory that creates a new Worker instance
   * @param count - Number of workers (defaults to hardwareConcurrency - 1, min 1)
   */
  constructor(
    private readonly createWorker: () => Worker,
    count?: number,
  ) {
    const workerCount = count ?? Math.max(1, (navigator?.hardwareConcurrency ?? 4) - 1);

    for (let i = 0; i < workerCount; i++) {
      const worker = createWorker();
      const entry: WorkerEntry<TResult> = {
        worker,
        busy: false,
        currentTask: null,
      };

      worker.onmessage = (e: MessageEvent) => {
        this.handleWorkerResponse(entry, e.data);
      };

      worker.onerror = (e: ErrorEvent) => {
        this.handleWorkerError(entry, new Error(e.message || 'Worker error'));
      };

      this.workers.push(entry);
    }
  }

  /** Number of workers in the pool. */
  get size(): number {
    return this.workers.length;
  }

  /** Number of tasks waiting in the queue. */
  get queueLength(): number {
    return this.queue.length;
  }

  /** Number of workers currently busy. */
  get busyCount(): number {
    return this.workers.filter(w => w.busy).length;
  }

  /**
   * Execute a task on the next available worker.
   * Returns a Promise that resolves with the worker's response.
   */
  execute(data: TData): Promise<TResult> {
    if (this.terminated) {
      return Promise.reject(new Error('WorkerPool has been terminated'));
    }

    return new Promise<TResult>((resolve, reject) => {
      const pending: PendingTask<TResult> = { resolve, reject };

      // Find an idle worker (round-robin starting from nextWorker)
      const idleWorker = this.findIdleWorker();

      if (idleWorker) {
        this.dispatchToWorker(idleWorker, data, pending);
      } else {
        // All workers busy: queue the task
        this.queue.push({ data, pending });
      }
    });
  }

  /**
   * Terminate all workers and reject any pending tasks.
   */
  terminate(): void {
    this.terminated = true;

    // Reject queued tasks
    for (const queued of this.queue) {
      queued.pending.reject(new Error('WorkerPool terminated'));
    }
    this.queue.length = 0;

    // Reject current tasks and terminate workers
    for (const entry of this.workers) {
      if (entry.currentTask) {
        entry.currentTask.reject(new Error('WorkerPool terminated'));
        entry.currentTask = null;
      }
      entry.worker.terminate();
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private findIdleWorker(): WorkerEntry<TResult> | null {
    for (let i = 0; i < this.workers.length; i++) {
      const idx = (this.nextWorker + i) % this.workers.length;
      if (!this.workers[idx].busy) {
        this.nextWorker = (idx + 1) % this.workers.length;
        return this.workers[idx];
      }
    }
    return null;
  }

  private dispatchToWorker(
    entry: WorkerEntry<TResult>,
    data: TData,
    pending: PendingTask<TResult>,
  ): void {
    entry.busy = true;
    entry.currentTask = pending;
    entry.worker.postMessage(data);
  }

  private handleWorkerResponse(entry: WorkerEntry<TResult>, result: TResult): void {
    const task = entry.currentTask;
    entry.busy = false;
    entry.currentTask = null;

    // Resolve the pending promise
    if (task) {
      task.resolve(result);
    }

    // Dispatch next queued task if any
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.dispatchToWorker(entry, next.data, next.pending);
    }
  }

  private handleWorkerError(entry: WorkerEntry<TResult>, error: Error): void {
    const task = entry.currentTask;
    entry.busy = false;
    entry.currentTask = null;

    if (task) {
      task.reject(error);
    }

    // Dispatch next queued task
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.dispatchToWorker(entry, next.data, next.pending);
    }
  }
}
