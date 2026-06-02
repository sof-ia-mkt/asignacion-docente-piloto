"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/dashboards", label: "Resumen" },
  { href: "/dashboards/cobertura", label: "Cobertura" },
  { href: "/dashboards/docentes", label: "Docentes" },
  { href: "/dashboards/riesgos", label: "Riesgos" },
  { href: "/dashboards/recomendacion", label: "Recomendación" },
];

export function SubNav() {
  const path = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b border-slate-200 pb-2">
      {tabs.map((t) => {
        const active = path === t.href;
        return (
          <Link key={t.href} href={t.href}
            className={`px-3 py-1.5 rounded-md text-sm ${active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
