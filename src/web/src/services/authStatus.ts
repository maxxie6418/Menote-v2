import type { AuthStatus, AuthUser } from "@menote/shared";

export function isAuthUser(value: unknown): value is AuthUser {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<AuthUser>;
  return typeof v.id === "string" && v.id.length > 0 && typeof v.username === "string"
    && (v.role === "owner" || v.role === "member");
}

function validStatus(value: unknown): value is AuthStatus {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<AuthStatus>;
  if (v.phase !== "bootstrap" && v.phase !== "login" && v.phase !== "ready") return false;
  if (typeof v.registrationOpen !== "boolean") return false;
  if (v.phase === "ready") return isAuthUser(v.user);
  return v.user === null || isAuthUser(v.user);
}

export async function fetchAuthStatus(signal: AbortSignal): Promise<AuthStatus | "unavailable"> {
  try {
    const response = await fetch("/api/auth/status", { signal, cache: "no-store" });
    if (!response.ok) return "unavailable";
    const body: unknown = await response.json();
    return validStatus(body) ? body : "unavailable";
  } catch (error) {
    if (signal.aborted) throw error;
    return "unavailable";
  }
}

let initial: Promise<AuthStatus | "unavailable"> | undefined;

export function preloadAuthStatus() {
  initial = fetchAuthStatus(AbortSignal.timeout(10_000)).catch(() => "unavailable" as const);
  return initial;
}

export function takeAuthStatus(signal: AbortSignal) {
  const request = initial;
  initial = undefined;
  return request ?? fetchAuthStatus(signal);
}
