import type { ReactNode } from "react";

export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="mn-settings-card">
    <h3>{title}</h3>
    <div className="mn-settings-fields">{children}</div>
  </section>;
}
