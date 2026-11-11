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
          <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined}
            className={`rounded-lg px-4 py-2 text-[15px] font-medium transition ${active ? "bg-white text-ink" : "text-white/65 hover:bg-white/10 hover:text-white"}`}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
