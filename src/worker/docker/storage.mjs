import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { migrations } from "../src/db/migrations/index.ts";
import { LocalDatabase } from "./local-db.mjs";
import { LocalBucket } from "./local-bucket.mjs";
export async function openStorage(input, state) {
  const legacyKeys = ["CF_D1_DATABASE_ID", "CF_D1_API_TOKEN", "CF_R2_BUCKET", "CF_R2_ACCESS_KEY_ID", "CF_R2_SECRET_ACCESS_KEY"];
  if ((input.MENOTE_STORAGE && input.MENOTE_STORAGE !== "local") ||
      (!input.MENOTE_STORAGE && legacyKeys.some(key => input[key]?.trim()))) {
    throw new Error("Cloudflare primary storage has been retired. Import the account ZIP into a local instance before switching MENOTE_STORAGE to local.");
  }
  const objects = join(state, "objects"), staging = join(state, "staging");
  await Promise.all([objects, staging].map(dir => mkdir(dir, { recursive: true, mode: 0o700 })));
  return {
    DB: new LocalDatabase(join(state, "menote.sqlite"), migrations.flatMap(m => m.statements)),
    BUCKET: new LocalBucket(objects, staging),
  };
}
