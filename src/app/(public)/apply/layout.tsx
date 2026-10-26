import { currentUser } from "@/lib/auth";
import { TopBar } from "../../ui";

export default async function ApplyLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <>
      <TopBar links={[]} who={user?.email} />
      <main className="container narrow">{children}</main>
    </>
  );
}
