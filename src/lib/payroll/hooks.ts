import { log } from "@/lib/logger";

/**
 * Adapter into the existing payroll module (D8). Stubs for now: ask how payroll
 * should be told before wiring these. Uptime for pay decisions: monitoring/uptime.ts.
 */
export async function onEmployeeActivated(personId: string, activatedAt: Date) {
  log.info("payroll hook: onEmployeeActivated (stub)", { personId, activatedAt });
}

export async function onEmployeeOffboarded(personId: string, offboardedAt: Date) {
  log.info("payroll hook: onEmployeeOffboarded (stub)", { personId, offboardedAt });
}
