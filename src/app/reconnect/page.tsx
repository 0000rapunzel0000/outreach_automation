import Link from "next/link";
import { TopBar } from "../ui";

const MESSAGES: Record<string, { title: string; body: string }> = {
  connected: { title: "You're already connected ✓", body: "Your LinkedIn is connected. Nothing else to do." },
  invalid: {
    title: "This link has expired",
    body: "Reconnect links work for a limited time. Log in to your portal and use the Reconnect LinkedIn button, or wait for the next reminder.",
  },
  busy: { title: "Too many attempts", body: "Please wait a few minutes and try the link again." },
  error: { title: "Something went wrong", body: "We couldn't start the reconnection. Please try the link again in a minute." },
};

export default async function ReconnectStatus({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state } = await searchParams;
  const m = MESSAGES[state ?? ""] ?? MESSAGES.invalid;
  return (
    <>
      <TopBar links={[]} />
      <main className="container narrow">
        <h1>{m.title}</h1>
        <div className="card">
          <p>{m.body}</p>
          <p>
            <Link href="/portal">Go to your portal</Link>
          </p>
        </div>
      </main>
    </>
  );
}
