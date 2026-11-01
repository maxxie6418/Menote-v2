import type { AuthStatus, AuthUser, CredentialsInput } from "@menote/shared";
import { validPassword, validUsername } from "@menote/shared";

export type AuthRequestResult = { ok: true; user: AuthUser } | { ok: false; code: string };

function isAuthUser(value: unknown): value is AuthUser {
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

/** 引导/注册/登录共用；服务端错误码原样透出，文案在 features/auth 层转换。 */
export async function submitCredentials(
  path: "/api/auth/bootstrap" | "/api/auth/login" | "/api/auth/register", input: CredentialsInput,
): Promise<AuthRequestResult> {
  if (!validUsername(input.username) || !validPassword(input.password)) {
    return { ok: false, code: "invalid_credentials" };
  }
  try {
    const response = await fetch(path, {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    const body: unknown = await response.json().catch(() => null);
    const user = (body as { user?: unknown } | null)?.user;
    if (response.ok && isAuthUser(user)) return { ok: true, user };
    const code = (body as { error?: unknown } | null)?.error;
    return { ok: false, code: typeof code === "string" ? code : `http_${response.status}` };
  } catch {
    return { ok: false, code: "network" };
  }
}

export async function logout(): Promise<{ ok: boolean }> {
  try {
    const response = await fetch("/api/auth/logout", { method: "POST", cache: "no-store" });
    return { ok: response.ok };
  } catch {
    return { ok: false };
  }
}

/** 站点图标 SVG 内容（登录检查屏加载动画内联用）。 */
export async function fetchLogoMarkup(): Promise<string> {
  try {
    const response = await fetch("/icon.svg");
    return await response.text();
  } catch {
    return "";
  }
}
