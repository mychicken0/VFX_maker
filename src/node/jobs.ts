export interface Job {
  progressUnit: "frames" | "projects";
  id: string;
  status:
    "queued" | "running" | "cancelling" | "cancelled" | "succeeded" | "failed";
  completed: number;
  total: number;
  result?: unknown;
  error?: string;
}
export class Jobs {
  private entries = new Map<
    string,
    { job: Job; controller: AbortController }
  >();
  private tail: Promise<unknown> = Promise.resolve();
  private serial = 0;
  start(
    run: (
      signal: AbortSignal,
      progress: (completed: number, total: number) => void,
    ) => Promise<unknown>,
    progressUnit: "frames" | "projects" = "frames",
  ): Job {
    if (this.entries.size >= 16) {
      const done = [...this.entries].find(([, e]) =>
        ["succeeded", "failed", "cancelled"].includes(e.job.status),
      );
      if (done) this.entries.delete(done[0]);
      else throw new Error("16 jobs are already active");
    }
    const job: Job = {
        progressUnit,
        id: `export-${++this.serial}`,
        status: "queued",
        completed: 0,
        total: 0,
      },
      controller = new AbortController();
    this.entries.set(job.id, { job, controller });
    this.tail = this.tail
      .catch(() => {})
      .then(async () => {
        if (controller.signal.aborted) {
          job.status = "cancelled";
          return;
        }
        job.status = "running";
        try {
          job.result = await run(controller.signal, (completed, total) => {
            job.completed = completed;
            job.total = total;
          });
          const result = job.result as
            { kind?: string; cancelled?: boolean; ok?: boolean } | undefined;
          job.status =
            result?.kind === "project-batch"
              ? result.cancelled
                ? "cancelled"
                : result.ok
                  ? "succeeded"
                  : "failed"
              : "succeeded";
          if (job.status === "failed")
            job.error = "Some batch items failed; inspect result.results.";
        } catch (e) {
          if (controller.signal.aborted) job.status = "cancelled";
          else {
            job.status = "failed";
            job.error = String(e instanceof Error ? e.message : e);
          }
        }
      });
    return { ...job };
  }
  get(id: string): Job {
    const e = this.entries.get(id);
    if (!e) throw new Error("Unknown export job");
    return { ...e.job };
  }
  cancel(id: string): Job {
    const e = this.entries.get(id);
    if (!e) throw new Error("Unknown export job");
    if (["queued", "running", "cancelling"].includes(e.job.status)) {
      e.job.status = "cancelling";
      e.controller.abort();
    }
    return this.get(id);
  }
  async close() {
    for (const e of this.entries.values()) e.controller.abort();
    await this.tail;
  }
}
