import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { migrations } from "../src/db/migrations/index.ts";
import { LocalDatabase } from "./local-db.mjs";
import { LocalBucket } from "./local-bucket.mjs";
import { D1HttpDatabase } from "./d1.mjs";
import { R2S3Bucket } from "./r2.mjs";

export async function openStorage(input, state) {
  const remoteKeys = ["CF_D1_DATABASE_ID", "CF_D1_API_TOKEN", "CF_R2_BUCKET", "CF_R2_ACCESS_KEY_ID", "CF_R2_SECRET_ACCESS_KEY"];
  const mode = input.MENOTE_STORAGE?.trim() || (remoteKeys.some(key => input[key]?.trim()) ? "cloudflare" : "local");
  if (mode === "cloudflare") {
    for (const key of ["CF_ACCOUNT_ID", ...remoteKeys]) if (!input[key]?.trim()) throw new Error("Missing configuration: " + key);
    if (!/^[a-f0-9]{32}$/i.test(input.CF_ACCOUNT_ID) || !/^[a-f0-9-]{36}$/i.test(input.CF_D1_DATABASE_ID)) throw new Error("Invalid Cloudflare storage identifiers");
    return { DB: new D1HttpDatabase(input.CF_ACCOUNT_ID, input.CF_D1_DATABASE_ID, input.CF_D1_API_TOKEN),
      BUCKET: new R2S3Bucket({ accountId: input.CF_ACCOUNT_ID, bucket: input.CF_R2_BUCKET,
        accessKeyId: input.CF_R2_ACCESS_KEY_ID, secretAccessKey: input.CF_R2_SECRET_ACCESS_KEY }) };
  }
  if (mode !== "local") throw new Error("MENOTE_STORAGE must be local or cloudflare");
  const objects = join(state, "objects"), staging = join(state, "staging");
  await Promise.all([objects, staging].map(dir => mkdir(dir, { recursive: true, mode: 0o700 })));
  return {
    DB: new LocalDatabase(join(state, "menote.sqlite"), migrations.flatMap(m => m.statements)),
    BUCKET: new LocalBucket(objects, staging),
  };
}
