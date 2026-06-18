import { ReactNode } from "react";

export interface KPICardProps {
  label: string;
  value: string; // pre-formatted, e.g. "$142,500"
  change?: string; // pre-formatted, e.g. "+3.2%"
  changeKind?: "positive" | "negative" | "neutral";
  sub?: string; // small secondary line under the value
  icon?: ReactNode;
}

const KPICard = ({ label, value, change, changeKind = "neutral", sub, icon }: KPICardProps) => (
  <div className={`kpi-card ${changeKind}`}>
    <div className="kpi-card-head">
      <span className="kpi-label">{label}</span>
      {icon ? <span className="kpi-icon">{icon}</span> : null}
    </div>
    <span className="kpi-value">{value}</span>
    {change ? (
      <span className={`kpi-change ${changeKind}`}>
        {changeKind === "positive" ? "▲ " : changeKind === "negative" ? "▼ " : ""}
        {change}
      </span>
    ) : null}
    {sub ? <span className="kpi-sub">{sub}</span> : null}
  </div>
);

export default KPICard;
