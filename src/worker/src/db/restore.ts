import { base64ToBytes, type KeyWrap } from "@menote/shared";

type ItemState = { id: string; rev: number; meta_rev: number; type: string; content_hash: string };
type CommentState = { id: string; rev: number; memo_id: string; parent_id: string | null; deleted_at: number | null };
type SettingState = { key: string; rev: number };

/** Only read the state needed for the merge, in one D1 batch rather than one request per row. */
export async function readRestoreState(
  db: SqlDatabase, userId: string, itemIds: Set<string>, commentIds: Set<string>, settingKeys: Set<string>,
) {
  const reads = (prefix: string, ids: Set<string>) => {
    const values = [...ids];
    const statements: SqlStatement[] = [];
    for (let i = 0; i < values.length; i += 500) {
      statements.push(db.prepare(prefix + " IN (SELECT value FROM json_each(?))").bind(userId, JSON.stringify(values.slice(i, i + 500))));
    }
    return statements;
  };
  const items = reads("SELECT id, rev, meta_rev, type, content_hash FROM items WHERE user_id = ? AND id", itemIds);
  const comments = reads("SELECT id, rev, memo_id, parent_id, deleted_at FROM memo_comments WHERE user_id = ? AND id", commentIds);
  const settings = reads("SELECT key, rev FROM user_settings WHERE user_id = ? AND key", settingKeys);
  const statements = [...items, ...comments, ...settings];
  const results = statements.length ? await db.batch(statements) : [];
  const rows = <T>(start: number, count: number) => results.slice(start, start + count).flatMap((result) => result.results as T[]);
  return {
    items: new Map(rows<ItemState>(0, items.length).map((row) => [row.id, row])),
    comments: new Map(rows<CommentState>(items.length, comments.length).map((row) => [row.id, row])),
    settings: new Map(rows<SettingState>(items.length + comments.length, settings.length).map((row) => [row.key, row.rev])),
  };
}

/** Abort the entire transaction if sync changed the selected revision after the preflight read. */
export function guardRestoreItems(
  db: SqlDatabase, userId: string, ids: string[], current: Map<string, ItemState>,
): SqlStatement[] {
  const statements: SqlStatement[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const expected = ids.slice(i, i + 500).map((id) => {
      const row = current.get(id);
      return [id, row ? [row.rev, row.meta_rev, row.content_hash] : null];
    });
    statements.push(db.prepare(
      `SELECT CASE WHEN NOT EXISTS (
         SELECT 1 FROM json_each(?) AS expected
         LEFT JOIN items ON items.id = json_extract(expected.value, '$[0]') AND items.user_id = ?
         WHERE (CASE WHEN items.id IS NOT NULL THEN json_array(items.rev, items.meta_rev, items.content_hash) END)
           IS NOT json_extract(expected.value, '$[1]')
       ) THEN 1 ELSE json(?) END`,
    ).bind(JSON.stringify(expected), userId, "restore_revision_changed"));
  }
  return statements;
}

/** A topic has no version counter. Refuse to replace an existing, different wrapping key. */
export function guardRestoreTopicWrap(db: SqlDatabase, userId: string, id: string, wrap: KeyWrap): SqlStatement {
  return db.prepare(
    `SELECT CASE WHEN NOT EXISTS (
       SELECT 1 FROM topic_key_wraps WHERE user_id = ? AND topic_id = ? AND wrapper = ?
       AND (generation != ? OR kdf_iterations != ? OR kdf_salt != ? OR iv != ? OR ciphertext != ?)
     ) THEN 1 ELSE json(?) END`,
  ).bind(userId, id, wrap.wrapper, wrap.generation, wrap.kdfIterations,
    base64ToBytes(wrap.kdfSalt), base64ToBytes(wrap.iv), base64ToBytes(wrap.ciphertext), "restore_topic_key_changed");
}
