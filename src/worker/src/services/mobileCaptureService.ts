import {
  MOBILE_CAPTURE_MAX_CHARS,
  type Item, type MobileCaptureRequest, type MobileCaptureResult, type MobileLoginResult,
} from "@menote/shared";
import { z } from "zod";
import { deleteMobileSession, readMobileUserId, storeMobileSession } from "../db/mobileSessions";
import { AuthError, SESSION_TTL_MS, authenticateLogin, newSessionToken, parseCredentials, sessionStorageId } from "./authService";
import { insertServerItem } from "./syncService";

const captureSchema: z.ZodType<MobileCaptureRequest> = z.object({
  operationId: z.uuid(),
  text: z.string().trim().min(1).max(MOBILE_CAPTURE_MAX_CHARS).refine(value => !value.includes("\0")),
  capturedAt: z.number().int().min(0).max(8_640_000_000_000_000),
});

export async function loginMobile(env: Env, body: unknown, now: number): Promise<MobileLoginResult> {
  const user = await authenticateLogin(env, parseCredentials(body), now);
  const token = newSessionToken();
  const expiresAt = now + SESSION_TTL_MS;
  await storeMobileSession(env.DB, await sessionStorageId(token), user.id, expiresAt, now);
  return { user, token, expiresAt };
}

function bearerToken(header: string | undefined): string {
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(header ?? "")?.[1];
  if (!token) throw new AuthError(401, "unauthorized");
  return token;
}

export async function logoutMobile(db: SqlDatabase, header: string | undefined): Promise<void> {
  await deleteMobileSession(db, await sessionStorageId(bearerToken(header)));
}

async function mobileUserId(db: SqlDatabase, header: string | undefined, now: number): Promise<string> {
  const userId = await readMobileUserId(db, await sessionStorageId(bearerToken(header)), now);
  if (!userId) throw new AuthError(401, "unauthorized");
  return userId;
}

function sharedUrl(text: string): URL | undefined {
  if (/\s/.test(text)) return;
  try {
    const url = new URL(text);
    if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) return url;
  } catch { /* Shared plain text is expected here. */ }
}

function noteMarkdown(input: MobileCaptureRequest, title: string, url: URL | undefined): string {
  const metadata = ["---", `page_title: ${JSON.stringify(title)}`];
  if (url) metadata.push(`source_url: ${JSON.stringify(url.href)}`);
  metadata.push(`clipped_at: ${JSON.stringify(new Date(input.capturedAt).toISOString())}`, "---", "");
  const body = url ? `<${url.href.replace(/[<>]/g, value => encodeURIComponent(value))}>`
    : input.text.split(/\r\n|\r|\n/).map(line => "> " + line.replace(/[\\`*_[\]<>~]/g, "\\$&")).join("\n");
  return `${metadata.join("\n")}\n${body}\n`;
}

export async function captureMobile(
  db: SqlDatabase, header: string | undefined, body: unknown, now: number,
): Promise<MobileCaptureResult> {
  const userId = await mobileUserId(db, header, now);
  const parsed = captureSchema.safeParse(body);
  if (!parsed.success) throw new AuthError(400, "invalid_capture");
  const input = parsed.data;
  const url = sharedUrl(input.text);
  const title = Array.from(input.text.split(/\r\n|\r|\n/, 1)[0]!).slice(0, 120).join("");
  const markdown = noteMarkdown(input, title, url);
  const item: Item = {
    id: input.operationId, userId, type: "note", topicId: null, groupId: null, title,
    content: { scope: "plain", markdown }, tags: [], status: null, attachmentHashes: [],
    source: "mobile", rev: 1, metaRev: 1, contentHash: await sessionStorageId(markdown),
    pinned: false, starred: false, createdAt: now, updatedAt: now, deletedAt: null,
  };
  try {
    return await insertServerItem({ db, userId, deviceId: "mobile", now }, item, input.operationId);
  } catch (error) {
    if (error instanceof Error && error.message === "operation_conflict") throw new AuthError(409, error.message);
    throw error;
  }
}
