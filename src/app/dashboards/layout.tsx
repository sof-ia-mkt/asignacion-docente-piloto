import { Suspense } from "react";
import { getPlanteles } from "@/lib/queries";
import { cicloActivo } from "@/lib/ciclo";
import { SubNav } from "./SubNav";
import { PlantelFilter } from "./PlantelFilter";

export default async function DashboardsLayout({ children }: { children: React.ReactNode }) {
  const [planteles, act] = await Promise.all([getPlanteles(), cicloActivo()]);
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Dashboards</h1>
        <span className="text-xs text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-3 py-1">
          Viendo: <b className="text-slate-700">{act.nombre}</b>
        </span>
      </div>
      <Suspense>
        <SubNav />
        <PlantelFilter planteles={planteles} />
      </Suspense>
      {children}
    </div>
  );
}
