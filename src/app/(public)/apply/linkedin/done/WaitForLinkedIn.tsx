"use client";

import { useEffect, useRef, useState } from "react";

type State = "waiting" | "timeout" | "duplicate";

/** Poll /api/me/linkedin-status every 2 s for up to 60 s (§8 step 3). */
export function WaitForLinkedIn() {
  const [state, setState] = useState<State>("waiting");
  const [attempt, setAttempt] = useState(0);
  const leaving = useRef(false);

  useEffect(() => {
    let stopped = false;
    const started = Date.now();
    async function tick() {
      if (stopped || leaving.current) return;
      try {
        const r = await fetch("/api/me/linkedin-status", { cache: "no-store" });
        const j = (await r.json()) as { state: string };
        if (j.state === "connected") {
          // One full-page navigation. Two overlapping client navigations (e.g. from a double-run effect)
          // abort each other and leave the person stuck on this page.
          if (!leaving.current) {
            leaving.current = true;
            window.location.replace("/apply/review");
          }
          return;
        }
        if (j.state === "duplicate") return setState("duplicate");
      } catch {}
      if (Date.now() - started > 60_000) return setState("timeout");
      setTimeout(tick, 2000);
    }
    setState("waiting");
    tick();
    return () => {
      stopped = true;
    };
  }, [attempt]);

  if (state === "duplicate")
    return (
      <div className="alert error">
        That LinkedIn account is already linked to another person. <a href="/apply/linkedin">Connect your own account</a>.
      </div>
    );
  if (state === "timeout")
    return (
      <div className="card">
        <p>We haven&apos;t heard back from LinkedIn yet. This can take a minute.</p>
        <div className="row">
          <button onClick={() => setAttempt((a) => a + 1)}>Check again</button>
          <a className="btn secondary" href="/apply/linkedin">
            Start over
          </a>
        </div>
      </div>
    );
  return (
    <div className="card">
      <p>Confirming your account with LinkedIn. This usually takes a few seconds…</p>
    </div>
  );
}
