import PgBoss from "pg-boss";
import { db } from "@/lib/db";
import { now } from "@/lib/clock";
import { log } from "@/lib/logger";

export const JOBS = {
  deliverNotification: "deliver-notification",
  promoteError: "promote-error",
  nudge: "nudge",
  deleteUnipileAccount: "delete-unipile-account",
  reconcile: "reconcile",
  retention: "retention",
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

export type SendOpts = { startAfter?: Date; singletonKey?: string; priority?: number; retryLimit?: number };

export interface Queue {
  send(name: JobName, data: object, opts?: SendOpts): Promise<string | null>;
  /** Cancel not-yet-run jobs whose singletonKey starts with prefix (e.g. "incident:<id>:"). */
  cancelByPrefix(prefix: string): Promise<number>;
}

// "short" policy = at most one queued job per singletonKey, so a rung can't be scheduled twice.
const QUEUE_OPTS: Record<JobName, PgBoss.Queue> = {
  "deliver-notification": { name: "deliver-notification", policy: "standard", retryLimit: 2, retryDelay: 30, retryBackoff: true },
  "promote-error": { name: "promote-error", policy: "short", retryLimit: 3, retryDelay: 60 },
  nudge: { name: "nudge", policy: "short", retryLimit: 3, retryDelay: 60 },
  "delete-unipile-account": { name: "delete-unipile-account", policy: "standard", retryLimit: 10, retryDelay: 300, retryBackoff: true },
  reconcile: { name: "reconcile", policy: "singleton", retryLimit: 0 },
  retention: { name: "retention", policy: "singleton", retryLimit: 1 },
};

let boss: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

/**
 * pg-boss instance. The worker starts it with maintenance on; the web app
 * starts a send-only instance (no supervision, no cron, no migrations).
 */
export function getBoss(role: "worker" | "web" = "web"): Promise<PgBoss> {
  if (boss) return Promise.resolve(boss);
  if (!starting) {
    starting = (async () => {
      const b = new PgBoss({
        connectionString: process.env.DATABASE_URL!,
        max: role === "worker" ? 10 : 3,
        supervise: role === "worker",
        schedule: role === "worker",
        migrate: role === "worker",
      });
      b.on("error", (e) => log.error("pg-boss error", { err: e }));
      await b.start();
      if (role === "worker") {
        for (const q of Object.values(QUEUE_OPTS)) {
          if (!(await b.getQueue(q.name))) await b.createQueue(q.name, q);
        }
      }
      boss = b;
      return b;
    })().catch((e) => {
      starting = null;
      throw e;
    });
  }
  return starting;
}

export async function stopBoss() {
  if (boss) await boss.stop({ graceful: true, wait: true });
  boss = null;
  starting = null;
}

export const QUEUE_OPTIONS = QUEUE_OPTS;

class PgBossQueue implements Queue {
  async send(name: JobName, data: object, opts: SendOpts = {}) {
    const b = await getBoss();
    // pg-boss validates every key present, so an explicit `undefined` (e.g. retryLimit) is rejected: drop them.
    const options = Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)) as PgBoss.SendOptions;
    const id = await b.send(name, data, options);
    if (!id && opts.singletonKey) log.debug("job deduped", { name, singletonKey: opts.singletonKey });
    return id;
  }

  async cancelByPrefix(prefix: string) {
    return db.$executeRaw`
      UPDATE pgboss.job SET state = 'cancelled', completed_on = now()
      WHERE singleton_key LIKE ${prefix + "%"} AND state IN ('created', 'retry')`;
  }
}

// ---- In-memory queue for tests: run due jobs synchronously against the fake clock (§12). ----

type MemJob = { id: string; name: JobName; data: any; startAfter: Date; singletonKey?: string; state: "created" | "done" | "cancelled" };
export type Handler = (data: any) => Promise<void>;

export class MemoryQueue implements Queue {
  jobs: MemJob[] = [];
  private seq = 0;
  constructor(private handlers: Partial<Record<JobName, Handler>> = {}) {}

  setHandlers(h: Partial<Record<JobName, Handler>>) {
    this.handlers = h;
  }

  async send(name: JobName, data: object, opts: SendOpts = {}) {
    if (opts.singletonKey && this.jobs.some((j) => j.state === "created" && j.name === name && j.singletonKey === opts.singletonKey)) {
      return null;
    }
    const id = `mem-${++this.seq}`;
    this.jobs.push({ id, name, data, startAfter: opts.startAfter ?? now(), singletonKey: opts.singletonKey, state: "created" });
    return id;
  }

  async cancelByPrefix(prefix: string) {
    let n = 0;
    for (const j of this.jobs) {
      if (j.state === "created" && j.singletonKey?.startsWith(prefix)) {
        j.state = "cancelled";
        n++;
      }
    }
    return n;
  }

  pending(name?: JobName) {
    return this.jobs.filter((j) => j.state === "created" && (!name || j.name === name));
  }

  /** Run every job due at the current (fake) time, including jobs those jobs schedule. */
  async runDue(maxRounds = 50) {
    for (let round = 0; round < maxRounds; round++) {
      const due = this.jobs.filter((j) => j.state === "created" && j.startAfter <= now());
      if (!due.length) return;
      for (const j of due) {
        j.state = "done";
        const h = this.handlers[j.name];
        if (h) await h(j.data);
      }
    }
  }

  clear() {
    this.jobs = [];
  }
}

let active: Queue = new PgBossQueue();

export function queue(): Queue {
  return active;
}

export function setQueue(q: Queue) {
  active = q;
}
