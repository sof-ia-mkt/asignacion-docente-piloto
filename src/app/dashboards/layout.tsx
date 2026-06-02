import { Suspense } from "react";
import { getPlanteles } from "@/lib/queries";
import { SubNav } from "./SubNav";
import { PlantelFilter } from "./PlantelFilter";

export default async function DashboardsLayout({ children }: { children: React.ReactNode }) {
  const planteles = await getPlanteles();
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-slate-900">Dashboards</h1>
      <Suspense>
        <SubNav />
        <PlantelFilter planteles={planteles} />
      </Suspense>
      {children}
    </div>
  );
}
