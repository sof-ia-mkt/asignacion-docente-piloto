"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { plantelCorto } from "@/lib/ui";

export function PlantelFilter({ planteles }: { planteles: { plantel: string; n: number }[] }) {
  const path = usePathname();
  const sp = useSearchParams();
  const actual = sp.get("plantel") ?? "";

  // Conserva la pestaña actual (path) y solo cambia el parámetro plantel.
  const href = (plantel: string) => `${path}${plantel ? `?plantel=${encodeURIComponent(plantel)}` : ""}`;
  const chip = (activo: boolean) =>
    `px-3 py-1.5 rounded-md text-sm border ${activo ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`;

  return (
    <div className="flex flex-wrap gap-1 items-center">
      <span className="text-xs text-slate-400 mr-1">Plantel:</span>
      <Link href={href("")} className={chip(actual === "")}>Todos</Link>
      {planteles.map((p) => (
        <Link key={p.plantel} href={href(p.plantel)} className={chip(actual === p.plantel)}>
          {plantelCorto(p.plantel)} <span className={actual === p.plantel ? "text-slate-300" : "text-slate-400"}>· {p.n}</span>
        </Link>
      ))}
    </div>
  );
}
