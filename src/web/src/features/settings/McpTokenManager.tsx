import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ChevronDown, ChevronUp, Copy } from "../../icons";
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
import { confirmDialog } from "../../components/ui/ConfirmDialog";
import { copyMcpConnectionPrompt } from "./mcpConnectionPrompt";
import { SettingsGroup } from "./SettingsGroup";

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

const dateTime = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });

async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

export function McpTokenManager({ userId }: { userId: string }) {
  const endpoint = useMemo(() => `${window.location.origin}/api/mcp`, []);
  const tokensKey = SETTINGS_CACHE.tokens(userId);
  const topicsKey = SETTINGS_CACHE.topics(userId);
  const [tokens, setTokens] = useState<McpTokenView[]>(() => (peek<McpTokenView[]>(tokensKey) ?? []).filter((token) => token.revokedAt === null));
  const [topics, setTopics] = useState<Array<Pick<TopicNode, "id" | "parentId" | "name" | "depth">>>(() => peek<Array<Pick<TopicNode, "id" | "parentId" | "name" | "depth">>>(topicsKey) ?? []);
  const [loading, setLoading] = useState(() => peek(tokensKey) === undefined || peek(topicsKey) === undefined);
  const [loadFailed, setLoadFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [visibleTokens, setVisibleTokens] = useState<Record<string, string>>({});
  const [copyingPromptId, setCopyingPromptId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async (fresh = false) => {
    const known = peek(tokensKey) !== undefined && peek(topicsKey) !== undefined;
    if (!known) setLoading(true);
    setLoadFailed(false);
    try {
      const [nextTokens, nextTopics] = await Promise.all([
        loadShared(tokensKey, listMcpTokens, fresh),
        loadShared(topicsKey, listMcpScopeTopics, fresh),
      ]);
      setTokens(nextTokens.filter((token) => token.revokedAt === null));
      setTopics(nextTopics);
    } catch (error) {
      setLoadFailed(true);
      setMessage(errorMessage(error));
    } finally { setLoading(false); }
  }, [tokensKey, topicsKey]);

  useEffect(() => { void refresh(); }, [refresh]);

  const copyEndpoint = async () => {
    try { await copyText(endpoint); setMessage("MCP 服务地址已复制。"); }
    catch { setMessage("复制失败，请检查浏览器剪贴板权限。"); }
  };

  const copyPrompt = async (token: McpTokenView) => {
    setCopyingPromptId(token.id);
    setMessage("");
    try {
      await copyMcpConnectionPrompt(endpoint, token);
      setMessage("已复制接入提示词、MCP 服务地址和此 Token，可直接粘贴给 AI。");
    } catch (error) {
      setMessage(error instanceof DOMException ? "复制失败，请检查浏览器剪贴板权限。" : errorMessage(error));
    } finally {
      setCopyingPromptId(null);
    }
  };

  const create = async (name: string, config: McpTokenConfig): Promise<void> => {
    try {
      await createMcpToken(name, config);
      setCreating(false);
      setMessage("Token 已创建，可复制 AI 接入提示词。");
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
    if (!await confirmDialog({ title: "撤销 Token", message: `确定撤销 ${token.tokenPrefix}？撤销后无法恢复，客户端需改用其他 Token。`, danger: true })) return;
    try {
      await revokeMcpToken(token.id);
      setVisibleTokens((current) => { const next = { ...current }; delete next[token.id]; return next; });
      setDetailsId((current) => current === token.id ? null : current);
      setMessage("Token 已撤销，后续请求立即失效。");
      await refresh(true);
    } catch (error) { setMessage(errorMessage(error)); }
  };

  return (
    <section className="mn-mcp-manager" aria-label="MCP 接入管理">
      <div className="mn-settings-card mn-mcp-connection">
        <h3 className="mn-mcp-title">服务地址</h3>
        <div className="mn-mcp-endpoint">
          <code className="mn-mcp-address">{endpoint}</code>
          <button type="button" className="mn-textbtn" onClick={() => void copyEndpoint()}>复制地址</button>
        </div>
        <p className="mn-sethint">使用 Streamable HTTP 与 Bearer Token。每个 Token 可以单独配置权限和访问范围。</p>
      </div>

      <div className="mn-mcp-heading">
        <h3 className="mn-mcp-title">访问 Token</h3>
        {!creating && <button type="button" className="mn-textbtn mn-settings-primary" disabled={loading || loadFailed} onClick={() => {
          setCreating(true);
          setDetailsId(null);
          setEditingId(null);
          setMessage("");
        }}>创建 Token</button>}
      </div>

      {message && <p className="mn-mcp-message" role="status">{message}</p>}
      {loadFailed && <button type="button" className="mn-textbtn mn-settings-outline" onClick={() => {
        setMessage("");
        void refresh(true);
      }}>重新加载 Token</button>}
      {creating && <TokenEditor topics={topics} onCancel={() => setCreating(false)} onSave={create} />}
      {loading && <p className="mn-mcp-empty">正在读取 Token…</p>}
      {!loading && !loadFailed && tokens.length === 0 && !creating && <p className="mn-settings-empty">还没有访问 Token。创建后可以复制该 Token 的 AI 接入提示词。</p>}
      {!loading && tokens.length > 0 && <div className="mn-mcp-token-list">
        {tokens.map((token) => {
          const expanded = detailsId === token.id;
          const panelId = `mn-mcp-detail-${token.id}`;
          return (
            <article className="mn-mcp-token-card" key={token.id} aria-label={token.name}>
              <div className="mn-mcp-token-head">
                <div className="mn-mcp-token-identity">
                  <h5 className="mn-mcp-title">{token.name}</h5>
                  <p className="mn-mcp-last-used">
                    {token.lastUsedAt === null ? "从未调用" : <>最近调用 <time dateTime={new Date(token.lastUsedAt).toISOString()}>{dateTime.format(token.lastUsedAt)}</time></>}
                  </p>
                </div>
                <div className="mn-mcp-actions">
                  <button type="button" className="mn-textbtn mn-mcp-copy" disabled={copyingPromptId !== null}
                    title="复制提示词、服务地址和此 Token" onClick={() => void copyPrompt(token)}>
                    <Copy aria-hidden="true" />
                    {copyingPromptId === token.id ? "正在复制…" : "复制 AI 接入提示词"}
                  </button>
                  <button type="button" className="mn-textbtn" aria-expanded={expanded} aria-controls={panelId} onClick={() => {
                    setDetailsId(expanded ? null : token.id);
                    setVisibleTokens({});
                    setEditingId(null);
                    setCreating(false);
                  }}>
                    {expanded ? "收起" : "详情"}
                    {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                  </button>
                </div>
              </div>
              <div id={panelId} className="mn-mcp-detail" hidden={!expanded}>
                {expanded && (editingId === token.id
                  ? <TokenEditor initial={token} topics={topics} onCancel={() => setEditingId(null)}
                      onSave={(name, config) => save(token.id, name, config)} />
                  : <>
                    <dl className="mn-mcp-meta">
                      <div><dt>Token</dt><dd><code>{token.tokenPrefix}</code></dd></div>
                      <div><dt>创建时间</dt><dd>{dateTime.format(token.createdAt)}</dd></div>
                      <div><dt>有效期</dt><dd>{token.expiresAt === null ? "永不过期" : dateTime.format(token.expiresAt)}</dd></div>
                      <div><dt>限速</dt><dd>{token.ratePerMinute} 次/分钟</dd></div>
                      <div className="mn-mcp-meta-wide"><dt>访问范围</dt><dd>{token.scope.mode === "all" ? "所有非加密主题" : `指定范围（${token.scope.topicIds.length + token.scope.groupIds.length} 项）`}</dd></div>
                      <div className="mn-mcp-meta-wide"><dt>权限</dt><dd>{token.permissions.length ? token.permissions.map((permission) => PERMISSION_LABELS[permission]).join("、") : "无（默认拒绝）"}</dd></div>
                    </dl>
                    {visibleTokens[token.id] && <div className="mn-mcp-secret"><code>{visibleTokens[token.id]}</code></div>}
                    <div className="mn-mcp-actions">
                      <button type="button" className="mn-textbtn" onClick={() => void reveal(token)}>查看并复制 Token</button>
                      <button type="button" className="mn-textbtn" onClick={() => setEditingId(token.id)}>修改设置</button>
                      <button type="button" className="mn-textbtn mn-mcp-revoke" onClick={() => void revoke(token)}>撤销 Token</button>
                    </div>
                  </>)}
              </div>
            </article>
          );
        })}
      </div>}
      <McpClientGuides endpoint={endpoint} />
    </section>
  );
}

function McpClientGuides({ endpoint }: { endpoint: string }) {
  const [feedback, setFeedback] = useState("");
  const guides = [
    {
      title: "Codex",
      hint: "在 Codex 的 config.toml 添加配置，并在 Codex 进程环境中设置 MENOTE_MCP_TOKEN。",
      snippet: '[mcp_servers.menote]\nurl = "' + endpoint + '"\nbearer_token_env_var = "MENOTE_MCP_TOKEN"',
    },
    {
      title: "Claude Code",
      hint: "以下是 .mcp.json 的配置结构。在 Claude Code 进程环境中设置 MENOTE_MCP_TOKEN。",
      snippet: JSON.stringify({ mcpServers: { menote: { type: "http", url: endpoint, headers: { Authorization: "Bearer ${MENOTE_MCP_TOKEN}" } } } }, null, 2),
    },
    {
      title: "通用 MCP 客户端",
      hint: "选择 Streamable HTTP，填入服务地址并设置 Authorization 请求头。",
      snippet: endpoint + "\nAuthorization: Bearer <你的 Menote Token>",
    },
  ];

  return <SettingsGroup title="连接客户端">
    <div className="mn-mcp-guides">
      {guides.map(guide => <details key={guide.title} className="mn-settings-fold">
        <summary>{guide.title}<ChevronDown aria-hidden="true" /></summary>
        <div className="mn-settings-fold-body">
          <p className="mn-sethint">{guide.hint}</p>
          <pre className="mn-settings-code"><code>{guide.snippet}</code></pre>
          <div className="mn-set-actions">
            <button type="button" className="mn-textbtn mn-settings-outline"
              aria-label={"复制 " + guide.title + " 配置"} onClick={() => void copyText(guide.snippet).then(
                () => setFeedback(guide.title + " 配置已复制。"),
                () => setFeedback("复制失败，请检查浏览器剪贴板权限。"),
              )}>复制配置</button>
          </div>
        </div>
      </details>)}
      {feedback && <p className="mn-sethint" role="status">{feedback}</p>}
    </div>
  </SettingsGroup>;
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
