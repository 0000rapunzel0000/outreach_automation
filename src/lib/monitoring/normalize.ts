import type { LinkStatus } from "@prisma/client";
import { log } from "@/lib/logger";

const MAP: Record<string, LinkStatus> = {
  OK: "CONNECTED",
  CREATION_SUCCESS: "CONNECTED",
  RECONNECTED: "CONNECTED",
  SYNC_SUCCESS: "CONNECTED",
  CONNECTING: "CONNECTING",
  CREDENTIALS: "NEEDS_RECONNECT",
  STOPPED: "NEEDS_RECONNECT",
  PERMISSIONS: "NEEDS_RECONNECT", // in Unipile's docs, not the spec: the user has to act (docs/DECISIONS.md)
  ERROR: "TRANSIENT_ERROR", // promoted to NEEDS_RECONNECT by the state machine after errorGraceMin
  DELETED: "DELETED",
};

export function normalize(raw: string): LinkStatus {
  const s = MAP[raw?.toUpperCase?.() ?? ""];
  if (s) return s;
  log.warn("unknown Unipile status; treating as TRANSIENT_ERROR", { raw });
  return "TRANSIENT_ERROR";
}

export const STATUS_LABEL: Record<LinkStatus, string> = {
  CONNECTED: "Connected",
  CONNECTING: "Connecting",
  NEEDS_RECONNECT: "Needs reconnect",
  TRANSIENT_ERROR: "Error (grace)",
  DELETED: "Deleted",
};
