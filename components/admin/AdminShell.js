"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AdminAccessPanel from "@/components/admin/AdminAccessPanel";
import {
  IconFileText,
  IconMonitor,
  IconQueue,
  IconReport,
  IconUserPlus,
  IconUsers
} from "@/components/admin/AdminIcons";

const navItems = [
  { href: "/admin/applicants/new", label: "Add applicant", Icon: IconUserPlus },
  { href: "/admin/bulk", label: "Bulk automate", Icon: IconUsers },
  { href: "/admin/applicants", label: "Queue", Icon: IconQueue },
  { href: "/admin/applications", label: "Applications", Icon: IconFileText },
  { href: "/admin/report", label: "Report", Icon: IconReport }
];

function isActive(pathname, item) {
  if (item.href === "/admin/applicants/new") {
    return pathname === "/admin/applicants/new";
  }
  if (item.href === "/admin/applicants") {
    return pathname === "/admin/applicants";
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavLink({ href, label, Icon, active }) {
  return (
    <Link
      href={href}
      className={
        active
          ? "inline-flex items-center gap-2 rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white"
          : "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
      }
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}

export default function AdminShell({ children, title, description, onSecretSaved }) {
  const pathname = usePathname();

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">
                  Driving licence automation
                </p>
                <h1 className="mt-1 text-2xl font-semibold text-slate-950">{title}</h1>
                {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
              </div>
              <AdminAccessPanel compact onSaved={onSecretSaved} />
            </div>
          </div>
          <nav className="flex flex-wrap gap-1 px-3 py-2">
            <NavLink href="/" label="Monitor" Icon={IconMonitor} active={false} />
            {navItems.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                Icon={item.Icon}
                active={isActive(pathname, item)}
              />
            ))}
          </nav>
        </header>
        {children}
      </div>
    </main>
  );
}
