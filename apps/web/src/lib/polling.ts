export type CompletionAwarePoller = {
  start(): void;
  stop(): void;
  refresh(): Promise<void>;
};

export function createCompletionAwarePoller(task: () => Promise<void>, delay: number): CompletionAwarePoller {
  let active = false;
  let timer: number | undefined;
  let pending: Promise<void> | undefined;

  const visible = () => typeof document === "undefined" || !document.hidden;
  const clear = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
  };
  const schedule = () => {
    clear();
    if (active && visible()) timer = window.setTimeout(() => void run(), delay);
  };
  const run = (): Promise<void> => {
    if (pending) return pending;
    clear();
    pending = Promise.resolve().then(task).finally(() => {
      pending = undefined;
      schedule();
    });
    return pending;
  };
  const onVisibilityChange = () => {
    if (!visible()) clear();
    else if (active) void run();
  };

  return {
    start() {
      if (active) return;
      active = true;
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibilityChange);
      if (visible()) void run();
    },
    stop() {
      active = false;
      clear();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibilityChange);
    },
    refresh: run
  };
}
