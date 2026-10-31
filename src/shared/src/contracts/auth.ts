/** 认证与会话契约（G1）。凭据永不进契约；用户标识与阶段状态是公开面。 */

/** 会话中的用户公开信息（不含任何凭据材料）。 */
export interface AuthUser {
  id: string;
  username: string;
  role: "owner" | "member";
}

/**
 * 认证阶段：
 * - bootstrap：库中零用户，部署者需先经引导页创建 owner；
 * - login：已有用户且当前访客未登录；
 * - ready：已登录（user 必存在）。
 */
export interface AuthStatus {
  phase: "bootstrap" | "login" | "ready";
  user: AuthUser | null;
  /** 仅在 login 阶段有意义：owner 是否开放了注册。 */
  registrationOpen: boolean;
}

export interface CredentialsInput {
  username: string;
  password: string;
}

/** 校验规则与前后端共用：用户名 1-32 字符；口令 8-128 字符。 */
export const USERNAME_MIN = 1;
export const USERNAME_MAX = 32;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export function validUsername(value: unknown): value is string {
  return typeof value === "string" && value.length >= USERNAME_MIN && value.length <= USERNAME_MAX
    && value.trim().length === value.length && !value.includes("\u0000");
}

export function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= PASSWORD_MIN && value.length <= PASSWORD_MAX
    && !value.includes("\u0000");
}
