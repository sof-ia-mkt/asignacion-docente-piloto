import { SubNav } from "./SubNav";

export default function DashboardsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-slate-900">Dashboards</h1>
      <SubNav />
      {children}
    </div>
  );
}
