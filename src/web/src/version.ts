export function formatVersionLabel(version: string, commit: string, buildTime: string): string {
  const parts = [`v${version}`, `构建 ${commit || "unknown"}`];
  if (buildTime) parts.push(buildTime);
  return parts.join(" · ");
}

export const APP_VERSION_LABEL: string = formatVersionLabel(__APP_VERSION__, __APP_BUILD_COMMIT__, __APP_BUILD_TIME__);
