import { currentUser } from "@/lib/auth";
import { TopBar } from "../ui";

// Pages enforce the role (portal/guard.ts). The layout doesn't, because /portal?reconnected=1 is
// Unipile's success redirect and the person tapping a WhatsApp link is often not logged in.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const employee = user?.role === "EMPLOYEE";
  return (
    <>
      <TopBar
        links={
          employee
            ? [
                { href: "/portal", label: "Home" },
                { href: "/portal/terms", label: "Terms" },
              ]
            : []
        }
        who={employee ? user.email : undefined}
      />
      <main className="container narrow">{children}</main>
    </>
  );
}
