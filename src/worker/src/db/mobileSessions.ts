export async function storeMobileSession(
  db: SqlDatabase, hash: string, userId: string, expiresAt: number, now: number,
): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM mobile_sessions WHERE expires_at <= ?").bind(now),
    db.prepare("INSERT INTO mobile_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .bind(hash, userId, expiresAt),
  ]);
}

export async function readMobileUserId(db: SqlDatabase, hash: string, now: number): Promise<string | null> {
  const row = await db.prepare("SELECT user_id FROM mobile_sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(hash, now).first<{ user_id: string }>();
  return row?.user_id ?? null;
}

export async function deleteMobileSession(db: SqlDatabase, hash: string): Promise<void> {
  await db.prepare("DELETE FROM mobile_sessions WHERE token_hash = ?").bind(hash).run();
}
