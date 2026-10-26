import { env } from "@/lib/env";
import { HttpUnipileClient } from "./client";
import { FakeUnipileClient } from "./fake";
import type { UnipileClient } from "./types";

export type { UnipileAccount, UnipileClient, HostedAuthOpts } from "./types";

let override: UnipileClient | null = null;
let real: UnipileClient | null = null;

/** The Unipile client: fake when UNIPILE_FAKE=true, or whatever a test injected. */
export function unipile(): UnipileClient {
  if (override) return override;
  if (!real) real = env().UNIPILE_FAKE ? new FakeUnipileClient() : new HttpUnipileClient();
  return real;
}

export function setUnipileClient(c: UnipileClient | null) {
  override = c;
}
