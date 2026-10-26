import Link from "next/link";
import { TopBar } from "../ui";

export default function Forbidden() {
  return (
    <>
      <TopBar links={[]} />
      <main className="container narrow">
        <h1>You don&apos;t have access to that page</h1>
        <p>
          <Link href="/">Go to your home page</Link>
        </p>
      </main>
    </>
  );
}
