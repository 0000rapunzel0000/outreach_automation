import { requireAdmin } from "@/lib/auth";
import { TopBar } from "../ui";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const links = [
    { href: "/admin/team", label: "Team" },
    { href: "/admin/applications", label: "Applications" },
    ...(user.role === "SUPER_ADMIN"
      ? [
          { href: "/admin/tos", label: "Terms" },
          { href: "/admin/settings", label: "Settings" },
          { href: "/admin/audit", label: "Audit log" },
        ]
      : []),
    { href: "/admin/me", label: "My alerts" },
  ];
  return (
    <>
      <TopBar links={links} who={`${user.email} (${user.role === "SUPER_ADMIN" ? "super admin" : "reviewer"})`} />
      <main className="container">{children}</main>
    </>
  );
}
