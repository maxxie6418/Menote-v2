export function formatVersionLabel(version: string, commit: string, buildTime: string): string {
  const parts = [`v${version}`, `构建 ${commit || "unknown"}`];
  if (buildTime) parts.push(buildTime);
  return parts.join(" · ");
}

/** 侧栏脚部用户名旁显示版本号；构建 id 悬停展示（负责人 2026-11-01）。 */
export const APP_VERSION_LABEL: string = `v${__APP_VERSION__}`;
export const APP_BUILD_LABEL: string = `构建 ${__APP_BUILD_COMMIT__ || "unknown"}`;
/** 系统状态页页脚的完整部署标识（版本 · 构建 · 时间）。 */
export const APP_VERSION_FULL_LABEL: string = formatVersionLabel(__APP_VERSION__, __APP_BUILD_COMMIT__, __APP_BUILD_TIME__);
