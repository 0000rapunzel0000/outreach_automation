import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { clientIp, createSession, currentUser, homeFor, verifyPassword } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { fail } from "@/lib/flash";
import { Flash, flashFrom, TopBar } from "../ui";

async function login(form: FormData) {
  "use server";
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) fail("/login", "Enter your email and password.");
  const email = parsed.data.email.toLowerCase().trim();
  const ip = await clientIp();
  if (!(await rateLimit(`login:ip:${ip}`, 20, 900)) || !(await rateLimit(`login:email:${email}`, 8, 900))) {
    fail("/login", "Too many attempts. Wait 15 minutes and try again.");
  }
  const user = await db.user.findUnique({ where: { email } });
  if (!user?.passwordHash || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    fail("/login", "Wrong email or password.");
  }
  await createSession(user.id);
  redirect(homeFor(user.role));
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await currentUser();
  if (user) redirect(homeFor(user.role));
  const { error } = await flashFrom(searchParams);
  return (
    <>
      <TopBar links={[]} />
      <main className="container narrow">
        <h1>Log in</h1>
        <Flash error={error} />
        <form action={login} className="card">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
          <p style={{ marginTop: 16 }}>
            <button type="submit">Log in</button>
          </p>
        </form>
        <p className="muted">
          New here? <Link href="/apply">Apply to join the outreach team</Link>.
        </p>
      </main>
    </>
  );
}
