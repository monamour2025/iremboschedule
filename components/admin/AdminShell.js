"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AdminAccessPanel from "@/components/admin/AdminAccessPanel";
import { IconQueue, IconReport, IconUsers } from "@/components/admin/AdminIcons";

const navItems = [
  { href: "/admin/bulk", label: "Estimate list", Icon: IconUsers },
  { href: "/admin/applicants", label: "Queue", Icon: IconQueue },
  { href: "/admin/report", label: "Report", Icon: IconReport }
];

function isActive(pathname, href) {
  if (href === "/admin/applicants") {
    return pathname === "/admin/applicants";
  }
  if (href === "/admin/bulk") {
    return pathname === "/admin/bulk" || pathname === "/admin";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AdminShell({ children, title, description, onSecretSaved }) {
  const pathname = usePathname();

  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="animate-fade-up overflow-hidden rounded-2xl border border-red-100 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-red-700 via-red-600 to-rose-500 px-5 py-4 text-white">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-red-100">Driving licence automation</p>
                <h1 className="mt-1 text-2xl font-semibold">{title}</h1>
                {description ? <p className="mt-1 text-sm text-red-50">{description}</p> : null}
              </div>
              <div className="rounded-xl bg-white/95 p-2 text-slate-900 shadow-sm">
                <AdminAccessPanel compact onSaved={onSecretSaved} />
              </div>
            </div>
          </div>
          <nav className="flex flex-wrap gap-1 px-3 py-2">
            {navItems.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.Icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    active
                      ? "inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white"
                      : "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-red-50"
                  }
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>
        {children}
      </div>
    </main>
  );
}
