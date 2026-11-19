/** Local database tests share this minimal in-memory account API. Worker tests cover D1 arbitration. */
export function installRecoveryCodeFixture() {
  const accounts = new Map();
  globalThis.fetch = async (input, init) => {
    const url = new URL(input, "https://menote.test");
    if (url.pathname !== "/api/recovery-code") throw new Error("unexpected request in recovery-code fixture");
    const user = url.searchParams.get("account");
    if (init.method === "POST" && !accounts.has(user)) accounts.set(user, JSON.parse(init.body).binding);
    return Response.json(accounts.has(user) ? { binding: accounts.get(user) } : { binding: null, revision: 0, legacyWraps: [] });
  };
  return () => accounts.clear();
}
