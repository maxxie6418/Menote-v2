/** 断点与布局类型（app/features 共用；数值常量随 AppShell 的 matchMedia 检测）。 */
export const BREAKPOINTS = { full: 1280, compact: 1024, tablet: 768 } as const;
export type LayoutMode = "full" | "compact" | "tablet" | "mobile";
export type MainView = "main" | "status";
export type ViewMode = "list" | "grid";
export type MobilePane = "list" | "doc";
