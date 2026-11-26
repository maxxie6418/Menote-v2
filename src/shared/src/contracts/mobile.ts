import type { AuthUser } from "./auth";

export { validPassword, validUsername, type AuthUser, type CredentialsInput } from "./auth";

export const MOBILE_API = {
  info: "/api/mobile/v1",
  login: "/api/mobile/v1/login",
  logout: "/api/mobile/v1/logout",
  capture: "/api/mobile/v1/capture",
} as const;

export const MOBILE_CAPTURE_MAX_CHARS = 32_000;

export interface MobileApiInfo {
  protocol: 1;
}

export interface MobileLoginResult {
  user: AuthUser;
  token: string;
  expiresAt: number;
}

export interface MobileCaptureRequest {
  operationId: string;
  text: string;
  capturedAt: number;
}

export interface MobileCaptureResult {
  itemId: string;
  rev: number;
  result: "applied" | "duplicate";
}
