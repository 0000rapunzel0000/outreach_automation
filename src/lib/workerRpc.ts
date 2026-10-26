import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export class WorkerUnavailableError extends Error {
  constructor() {
    super("The background worker didn't respond. Please try again in a minute.");
  }
}

/** Web -> worker call through a WorkerCommand row; the worker polls every second. */
export async function workerRpc<T>(kind: string, payload: Prisma.InputJsonValue, timeoutMs = 15_000): Promise<T> {
  const cmd = await db.workerCommand.create({ data: { kind, payload } });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    const row = await db.workerCommand.findUnique({ where: { id: cmd.id } });
    if (row?.status === "done") return row.result as T;
    if (row?.status === "error") throw new Error((row.result as { message?: string } | null)?.message ?? "worker error");
  }
  await db.workerCommand.updateMany({ where: { id: cmd.id, status: "pending" }, data: { status: "error", result: { message: "timeout" } } });
  throw new WorkerUnavailableError();
}
