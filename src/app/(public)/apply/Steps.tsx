import { STEP_LABELS } from "@/lib/onboarding/steps";

export function Steps({ current }: { current: number }) {
  return (
    <div className="steps" aria-label="Application progress">
      {STEP_LABELS.map((l, i) => (
        <span key={l} className={i < current ? "done" : i === current ? "current" : ""}>
          {i + 1}. {l}
        </span>
      ))}
    </div>
  );
}
