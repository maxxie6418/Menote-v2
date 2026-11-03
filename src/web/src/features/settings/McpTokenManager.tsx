import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  MCP_PERMISSION_KEYS,
  type McpPermission,
  type McpTokenConfig,
  type McpTokenScope,
  type McpTokenView,
  type TopicNode,
} from "@menote/shared";
import {
  createMcpToken, listMcpScopeTopics, listMcpTokens, revealMcpToken, revokeMcpToken, updateMcpToken,
} from "../../services/mcpTokenService";
import { loadShared, peek, SETTINGS_CACHE } from "../../services/settingsPrefetch";

const PERMISSION_LABELS: Record<McpPermission, string> = {
  "content:read": "读取内容",
  "item:create": "创建条目",
  "item:edit": "编辑条目",
  "trash:move": "移入回收站",
  "attachment:access": "附件上传与读取",
  "clip:templates:read": "同步剪藏模板",
  "clip:templates:write": "保存剪藏模板",
  "bookmark:write": "收藏到指定文档/表格",
};

const EMPTY_CONFIG: McpTokenConfig = {
  permissions: [], scope: { mode: "all", topicIds: [], groupIds: [] },
  includeMemos: false, allowUrl: false, ratePerMinute: 60, expiresAt: null,
};

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "请求失败，请稍后重试。";
  if (error.message === "invalid_scope") return "范围里包含无效或已删除的主题，请刷新后重试。";
  if (error.message === "invalid_request") return "设置格式无效，请检查后重试。";
  if (error.message === "unavailable") return "服务暂不可用，请检查部署配置后重试。";
  if (error.message === "not_found") return "该 Token 已不存在或已撤销。";
  return "请求失败，请稍后重试。";
}

function formatDate(value: number | null): string {
  if (value === null) return "从未调用";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

export function McpTokenManager() {
  const endpoint = useMemo(() => `${window.location.origin}/api/mcp`, []);
  const [tokens, setTokens] = useState<McpTokenView[]>(() => (peek<McpTokenView[]>(SETTINGS_CACHE.tokens) ?? []).filter((token) => token.revokedAt === null));
  const [topics, setTopics] = useState<Array<Pick<TopicNode, "id" | "parentId" | "name" | "depth">>>(() => peek<Array<Pick<TopicNode, "id" | "parentId" | "name" | "depth">>>(SETTINGS_CACHE.topics) ?? []);
  const [loading, setLoading] = useState(() => peek(SETTINGS_CACHE.tokens) === undefined || peek(SETTINGS_CACHE.topics) === undefined);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [visibleTokens, setVisibleTokens] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");

  const refresh = useCallback(async (fresh = false) => {
    const known = peek(SETTINGS_CACHE.tokens) !== undefined && peek(SETTINGS_CACHE.topics) !== undefined;
    if (!known) setLoading(true);
    try {
      const [nextTokens, nextTopics] = await Promise.all([
        loadShared(SETTINGS_CACHE.tokens, listMcpTokens, fresh),
        loadShared(SETTINGS_CACHE.topics, listMcpScopeTopics, fresh),
      ]);
      setTokens(nextTokens.filter((token) => token.revokedAt === null));
      setTopics(nextTopics);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const copyEndpoint = async () => {
    try { await copyText(endpoint); setMessage("MCP 服务地址已复制。"); }
    catch { setMessage("复制失败，请检查浏览器剪贴板权限。"); }
  };

  const create = async (name: string, config: McpTokenConfig): Promise<void> => {
    try {
      const created = await createMcpToken(name, config);
      const secret = await revealMcpToken(created.id);
      setVisibleTokens((current) => ({ ...current, [created.id]: secret }));
      setCreating(false);
      setMessage("Token 已创建。可复制地址和 Token 配置客户端；Token 可随时在此重新查看。");
      await refresh(true);
    } catch (error) { setMessage(errorMessage(error)); }
  };

  const save = async (id: string, name: string, config: McpTokenConfig): Promise<void> => {
    try {
      await updateMcpToken(id, name, config);
      setEditingId(null);
      setMessage("Token 名称与权限已更新，后续请求立即使用新配置。");
      await refresh(true);
    } catch (error) { setMessage(errorMessage(error)); }
  };

  const reveal = async (token: McpTokenView) => {
    try {
      const secret = await revealMcpToken(token.id);
      setVisibleTokens((current) => ({ ...current, [token.id]: secret }));
      await copyText(secret);
      setMessage("Token 已显示并复制到剪贴板。");
    } catch (error) { setMessage(error instanceof Error && error.name === "NotAllowedError" ? "Token 已显示，但浏览器未允许剪贴板访问。" : errorMessage(error)); }
  };

  const revoke = async (token: McpTokenView) => {
    if (!window.confirm(`确定撤销 ${token.tokenPrefix}？撤销后无法恢复，客户端需改用其他 Token。`)) return;
    try {
      await revokeMcpToken(token.id);
      setVisibleTokens((current) => { const next = { ...current }; delete next[token.id]; return next; });
      setMessage("Token 已撤销，后续请求立即失效。");
      await refresh(true);
    } catch (error) { setMessage(errorMessage(error)); }
  };

  return (
    <section className="mn-mcp-manager" aria-label="MCP 接入管理">
      <div className="mn-setrow mn-mcp-endpoint">
        <div>
          <p className="mn-setlabel">MCP 服务地址</p>
          <p className="mn-sethint">配置丢失时可在此复制地址，并重新查看已有 Token；无需重建。</p>
        </div>
        <code className="mn-mcp-address">{endpoint}</code>
        <button type="button" className="mn-statuslink" onClick={() => void copyEndpoint()}>复制地址</button>
      </div>

      <div className="mn-mcp-heading">
        <div>
          <p className="mn-setlabel">访问 Token</p>
          <p className="mn-sethint">每个 Token 可单独授权。内容读取关闭时仍可执行已授权的写入。</p>
        </div>
        <button type="button" className="app-button" onClick={() => { setCreating((value) => !value); setEditingId(null); setMessage(""); }}>
          {creating ? "取消创建" : "创建 Token"}
        </button>
      </div>

      {message && <p className="mn-mcp-message" role="status">{message}</p>}
      {creating && <TokenEditor topics={topics} onCancel={() => setCreating(false)} onSave={create} />}
      {loading ? <p className="mn-sethint">正在读取 Token…</p> : tokens.length === 0 && !creating
        ? <p className="mn-mcp-empty">目前没有可用的 MCP Token。已撤销的 Token 不显示。</p>
        : <div className="mn-mcp-token-list">{tokens.map((token) => (
          <article className="mn-mcp-token-card" key={token.id}>
            <div className="mn-mcp-token-head">
              <div>
                <p className="mn-setlabel">{token.name}{token.revokedAt !== null && <span className="mn-mcp-revoked">已撤销</span>}</p>
                <p className="mn-sethint"><code>{token.tokenPrefix}</code> · 创建于 {formatDate(token.createdAt)} · 最后调用：{formatDate(token.lastUsedAt)}</p>
              </div>
              <div className="mn-mcp-actions">
                {token.revokedAt === null && <button type="button" className="mn-statuslink" onClick={() => void reveal(token)}>查看并复制 Token</button>}
                {token.revokedAt === null && <button type="button" className="mn-statuslink" onClick={() => { setEditingId(editingId === token.id ? null : token.id); setCreating(false); }}>修改设置</button>}
                {token.revokedAt === null && <button type="button" className="mn-statuslink" onClick={() => void revoke(token)}>撤销</button>}
              </div>
            </div>
            {visibleTokens[token.id] && <div className="mn-mcp-secret"><code>{visibleTokens[token.id]}</code></div>}
            <p className="mn-sethint">权限：{token.permissions.length ? token.permissions.map((permission) => PERMISSION_LABELS[permission]).join("、") : "无（默认拒绝）"}</p>
            <p className="mn-sethint">范围：{token.scope.mode === "all" ? "所有非加密主题" : `指定范围（${token.scope.topicIds.length + token.scope.groupIds.length} 项）`} · 限速 {token.ratePerMinute}/分钟 · {token.expiresAt === null ? "永不过期" : `过期于 ${formatDate(token.expiresAt)}`}</p>
            {editingId === token.id && <TokenEditor
              initial={token} topics={topics} onCancel={() => setEditingId(null)} onSave={(name, config) => save(token.id, name, config)}
            />}
          </article>
        ))}</div>}
    </section>
  );
}

function TokenEditor({
  initial, topics, onCancel, onSave,
}: {
  initial?: McpTokenView;
  topics: Array<Pick<TopicNode, "id" | "parentId" | "name" | "depth">>;
  onCancel: () => void;
  onSave: (name: string, config: McpTokenConfig) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [permissions, setPermissions] = useState<McpPermission[]>(initial?.permissions ?? EMPTY_CONFIG.permissions);
  const [scope, setScope] = useState<McpTokenScope>(initial?.scope ?? EMPTY_CONFIG.scope);
  const [includeMemos, setIncludeMemos] = useState(initial?.includeMemos ?? false);
  const [allowUrl, setAllowUrl] = useState(initial?.allowUrl ?? false);
  const [rate, setRate] = useState(String(initial?.ratePerMinute ?? EMPTY_CONFIG.ratePerMinute));
  const [expiry, setExpiry] = useState(() => initial?.expiresAt ? toLocalDateTime(initial.expiresAt) : "");
  const [saving, setSaving] = useState(false);

  const togglePermission = (permission: McpPermission, checked: boolean) => {
    setPermissions((current) => checked ? [...new Set([...current, permission])] : current.filter((item) => item !== permission));
  };
  const toggleScopeId = (kind: "topicIds" | "groupIds", id: string, checked: boolean) => {
    setScope((current) => ({
      mode: "selected",
      topicIds: kind === "topicIds" ? checked ? [...new Set([...current.topicIds, id])] : current.topicIds.filter((value) => value !== id) : current.topicIds,
      groupIds: kind === "groupIds" ? checked ? [...new Set([...current.groupIds, id])] : current.groupIds.filter((value) => value !== id) : current.groupIds,
    }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const rateNumber = Number(rate);
    if (!Number.isInteger(rateNumber) || rateNumber < 1 || rateNumber > 10_000) return;
    const expiryTimestamp = expiry ? new Date(expiry).getTime() : null;
    if (expiryTimestamp !== null && (!Number.isFinite(expiryTimestamp) || expiryTimestamp <= Date.now())) return;
    const normalizedName = name.trim();
    if (initial && (!normalizedName || normalizedName.length > 80)) return;
    if (normalizedName.length > 80) return;
    setSaving(true);
    try { await onSave(normalizedName, { permissions, scope, includeMemos, allowUrl, ratePerMinute: rateNumber, expiresAt: expiryTimestamp }); }
    finally { setSaving(false); }
  };

  return (
    <form className="mn-mcp-editor" onSubmit={submit}>
      <label className="mn-mcp-number">名称<input className="mn-propinput" type="text" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="留空自动命名，如 menote1" /></label>
      <fieldset className="mn-mcp-fieldset">
        <legend className="mn-setlabel">权限（未勾选即拒绝）</legend>
        <div className="mn-mcp-check-grid">
          {MCP_PERMISSION_KEYS.map((permission) => <label className="mn-mcp-check" key={permission}>
            <input type="checkbox" checked={permissions.includes(permission)} onChange={(event) => togglePermission(permission, event.target.checked)} />
            <span>{PERMISSION_LABELS[permission]}</span>
          </label>)}
        </div>
      </fieldset>

      <fieldset className="mn-mcp-fieldset">
        <legend className="mn-setlabel">可访问范围</legend>
        <label className="mn-mcp-check">
          <input type="radio" name="mcp-scope" checked={scope.mode === "all"} onChange={() => setScope({ mode: "all", topicIds: [], groupIds: [] })} />
          <span>所有非加密主题</span>
        </label>
        <label className="mn-mcp-check">
          <input type="radio" name="mcp-scope" checked={scope.mode === "selected"} onChange={() => setScope({ mode: "selected", topicIds: [], groupIds: [] })} />
          <span>仅指定范围</span>
        </label>
        {scope.mode === "selected" && <div className="mn-mcp-scope-list">
          {topics.length === 0 ? <p className="mn-sethint">当前没有可选的非加密主题。</p> : topics.map((topic) => {
            const isGroup = topic.depth === 1;
            const selected = isGroup ? scope.groupIds : scope.topicIds;
            return <label className={`mn-mcp-check${isGroup ? " child" : ""}`} key={topic.id}>
              <input type="checkbox" checked={selected.includes(topic.id)} onChange={(event) => toggleScopeId(isGroup ? "groupIds" : "topicIds", topic.id, event.target.checked)} />
              <span>{isGroup ? "↳ " : ""}{topic.name}</span>
            </label>;
          })}
        </div>}
      </fieldset>

      <div className="mn-mcp-options">
        <label className="mn-mcp-check"><input type="checkbox" checked={includeMemos} onChange={(event) => setIncludeMemos(event.target.checked)} /><span>包含 Memo</span></label>
        <label className="mn-mcp-check"><input type="checkbox" checked={allowUrl} onChange={(event) => setAllowUrl(event.target.checked)} /><span>允许返回 URL</span></label>
        <label className="mn-mcp-number">每分钟限速<input className="mn-propinput" type="number" min="1" max="10000" value={rate} onChange={(event) => setRate(event.target.value)} /></label>
        <label className="mn-mcp-number">过期时间<input className="mn-propinput" type="datetime-local" value={expiry} onChange={(event) => setExpiry(event.target.value)} /></label>
      </div>
      <p className="mn-sethint">收藏权限只允许向指定明文文档/表格追加，不返回既有内容；可与内容读取权限分开。附件操作还需对应内容权限；加密内容和私人空间始终拒绝。移入回收站不包含永久删除。</p>
      <div className="mn-mcp-actions">
        <button type="submit" className="app-button" disabled={saving || (Boolean(initial) && !name.trim())}>{saving ? "保存中…" : initial ? "保存设置" : "创建 Token"}</button>
        <button type="button" className="mn-statuslink" onClick={onCancel}>取消</button>
      </div>
    </form>
  );
}

function toLocalDateTime(timestamp: number): string {
  const date = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}
