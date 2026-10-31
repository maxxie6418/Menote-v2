/** Public health responses intentionally contain no infrastructure diagnostics. */
export interface HealthResponse {
  status: "alive" | "ready" | "unavailable";
}
