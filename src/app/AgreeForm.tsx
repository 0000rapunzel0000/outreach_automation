"use client";

import { useState } from "react";

/** Unticked checkbox; the button stays disabled until the person ticks it themselves (§8 step 1). */
export function AgreeForm({
  action,
  tosVersionId,
  version,
  buttonLabel,
}: {
  action: (form: FormData) => Promise<void>;
  tosVersionId: string;
  version: number;
  buttonLabel: string;
}) {
  const [agreed, setAgreed] = useState(false);
  return (
    <form action={action} style={{ marginTop: 16 }}>
      <input type="hidden" name="tosVersionId" value={tosVersionId} />
      <label className="check">
        <input type="checkbox" name="agree" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>I have read and agree to the Terms of Service (v{version})</span>
      </label>
      <p style={{ marginTop: 12 }}>
        <button type="submit" disabled={!agreed}>
          {buttonLabel}
        </button>
      </p>
    </form>
  );
}
