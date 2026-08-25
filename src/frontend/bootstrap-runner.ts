import type { BootstrapStatusView } from "../shared/types";

export class BootstrapFailedError extends Error {
  constructor(readonly bootstrapStatus: BootstrapStatusView) {
    super(bootstrapStatus.errorCode ?? "DATABASE_BOOTSTRAP_FAILED");
    this.name = "BootstrapFailedError";
  }
}

interface BootstrapRunnerOptions {
  getStatus(): Promise<BootstrapStatusView>;
  step(): Promise<BootstrapStatusView>;
  onStatus?(status: BootstrapStatusView): void;
  delay?(milliseconds: number): Promise<void>;
  pollDelayMs?: number;
}

const defaultDelay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** 以短請求推進持久化 bootstrap，不把長工作綁在單一 HTTP request。 */
export async function runBootstrap(
  options: BootstrapRunnerOptions,
): Promise<BootstrapStatusView> {
  const delay = options.delay ?? defaultDelay;
  let current = await options.getStatus();
  options.onStatus?.(current);

  while (current.status !== "complete") {
    if (current.status === "failed") throw new BootstrapFailedError(current);
    current = await options.step();
    options.onStatus?.(current);
    if (current.status === "failed") throw new BootstrapFailedError(current);
    if (current.status !== "complete") {
      await delay(options.pollDelayMs ?? 120);
    }
  }

  return current;
}
