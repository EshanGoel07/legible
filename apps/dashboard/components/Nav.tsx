"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/tools", label: "Tools" },
  { href: "/report", label: "Report" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1">
      {TABS.map((t) => {
        const active = path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={`rounded-lg px-4 py-2 text-[15px] font-medium transition ${active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
