import { redirect } from "next/navigation";

function withParam(path: string, key: string, msg: string) {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(msg)}`;
}

/** Redirect back with ?error=… (server actions report errors this way). */
export function fail(path: string, msg: string): never {
  redirect(withParam(path, "error", msg));
}

export function succeed(path: string, msg: string): never {
  redirect(withParam(path, "ok", msg));
}

/** Rethrow Next's redirect/notFound signals; anything else becomes a user-facing message. */
export function errMsg(e: unknown): string {
  if (e && typeof e === "object" && "digest" in e && typeof (e as { digest: unknown }).digest === "string") {
    const d = (e as { digest: string }).digest;
    if (d.startsWith("NEXT_REDIRECT") || d.startsWith("NEXT_NOT_FOUND") || d.startsWith("NEXT_HTTP_ERROR")) throw e;
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}
