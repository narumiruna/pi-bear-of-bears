import { setTimeout as sleep } from "node:timers/promises";
import type { GameMessage } from "./game.js";

export const WATCH_STATUS_EVENT = "bears:watch-status";
export const WATCH_STATUS_REQUEST_EVENT = "bears:watch-status-request";

export type WatchStatus =
  | "off"
  | "connecting"
  | "listening"
  | "disconnected"
  | "error";

export interface WatchConnection {
  connect: () => Promise<void>;
  subscribe: (
    onMessage: (message: GameMessage) => void,
    onConnection: (connected: boolean) => void,
  ) => () => void;
  close: () => Promise<void>;
}

export interface WatchBatch {
  messages: GameMessage[];
  omitted: number;
}

interface Run {
  controller: AbortController;
  ready?: Promise<void>;
  connection?: WatchConnection;
  unsubscribe?: () => void;
  timer?: ReturnType<typeof setTimeout>;
  pending: Map<number, GameMessage>;
  seen: Map<number, string>;
  omitted: number;
  flushing: boolean;
}

export class GameWatch {
  private run?: Run;
  status: WatchStatus = "off";

  constructor(
    private readonly createConnection: () => Promise<WatchConnection>,
    private readonly onBatch: (
      batch: WatchBatch,
      signal: AbortSignal,
    ) => Promise<void>,
    private readonly onStatus: (status: WatchStatus) => void,
    private readonly batchMs = 500,
    private readonly startupTimeoutMs = 30_000,
  ) {}

  private setStatus(status: WatchStatus) {
    this.status = status;
    this.onStatus(status);
  }

  start(): Promise<void> {
    if (this.run) {
      return this.run.ready ?? Promise.resolve();
    }
    const run: Run = {
      controller: new AbortController(),
      pending: new Map(),
      seen: new Map(),
      omitted: 0,
      flushing: false,
    };
    this.run = run;
    this.setStatus("connecting");
    run.ready = this.connect(run);
    return run.ready;
  }

  private async connect(run: Run) {
    const timeout = setTimeout(
      () => run.controller.abort(),
      this.startupTimeoutMs,
    );
    let abortHandler: (() => void) | undefined;
    try {
      const connection = await this.createConnection();
      run.connection = connection;
      run.controller.signal.throwIfAborted();
      const aborted = new Promise<never>((_resolve, reject) => {
        abortHandler = () => reject(new Error("Watch connection cancelled."));
        run.controller.signal.addEventListener("abort", abortHandler, {
          once: true,
        });
      });
      await Promise.race([connection.connect(), aborted]);
      run.controller.signal.throwIfAborted();
      run.unsubscribe = connection.subscribe(
        (message) => this.receive(run, message),
        (connected) => {
          if (this.run === run) {
            this.setStatus(connected ? "listening" : "disconnected");
          }
        },
      );
      this.setStatus("listening");
    } catch {
      // Do not forward raw SDK errors or local credential paths into model context.
      if (this.run === run) {
        this.run = undefined;
        run.controller.abort();
        this.setStatus("error");
      }
      await this.close(run);
    } finally {
      clearTimeout(timeout);
      if (abortHandler) {
        run.controller.signal.removeEventListener("abort", abortHandler);
      }
    }
  }

  private receive(run: Run, message: GameMessage) {
    if (
      this.run !== run ||
      run.controller.signal.aborted ||
      run.seen.get(message.id) === message.revision
    ) {
      return;
    }
    run.seen.delete(message.id);
    run.seen.set(message.id, message.revision);
    if (run.seen.size > 200) {
      run.seen.delete(run.seen.keys().next().value as number);
    }
    run.pending.set(message.id, message);
    if (run.pending.size > 20) {
      run.pending.delete(run.pending.keys().next().value as number);
      run.omitted++;
    }
    this.schedule(run);
  }

  private schedule(run: Run) {
    if (run.timer || run.flushing || run.pending.size === 0) {
      return;
    }
    run.timer = setTimeout(() => {
      run.timer = undefined;
      void this.flush(run);
    }, this.batchMs);
  }

  private async flush(run: Run) {
    if (this.run !== run || run.controller.signal.aborted) {
      return;
    }
    const batch = {
      messages: [...run.pending.values()].sort((a, b) => a.id - b.id),
      omitted: run.omitted,
    };
    run.pending.clear();
    run.omitted = 0;
    run.flushing = true;
    try {
      await this.onBatch(batch, run.controller.signal);
    } catch {
      if (this.run === run) {
        this.run = undefined;
        run.controller.abort();
        this.setStatus("error");
        await this.close(run);
      }
    } finally {
      run.flushing = false;
      if (this.run === run) {
        this.schedule(run);
      }
    }
  }

  private async close(run: Run) {
    run.unsubscribe?.();
    run.unsubscribe = undefined;
    if (run.timer) {
      clearTimeout(run.timer);
    }
    run.pending.clear();
    if (run.connection) {
      await Promise.race([
        run.connection.close().catch(() => undefined),
        sleep(1000),
      ]);
    }
  }

  async stop() {
    const run = this.run;
    this.run = undefined;
    this.setStatus("off");
    if (run) {
      run.controller.abort();
      await this.close(run);
    }
  }
}
