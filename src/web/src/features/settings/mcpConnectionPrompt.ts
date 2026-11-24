import type { McpTokenView } from "@menote/shared";
import { revealMcpToken } from "../../services/mcpTokenService";

function formatPrompt(endpoint: string, secret: string, token: McpTokenView): string {
  const permissions = new Set(token.permissions);
  const canRead = permissions.has("content:read");
  const canCreate = permissions.has("item:create");
  const attachments = permissions.has("attachment:access");
  const abilities = ["验证连接"];
  if (canRead) abilities.push("搜索和列出笔记，浏览主题与分组，读取正文与可用的云端版本");
  if (canCreate) abilities.push(`新建 Note、表格${token.includeMemos ? "和 Memo" : ""}，以及剪藏网页`);
  if (permissions.has("bookmark:write")) abilities.push("向指定的文档或表格追加网址收藏");
  if (attachments && canRead) abilities.push("读取可访问条目中的附件");
  if (attachments && canCreate) abilities.push("为新条目上传附件");
  if (permissions.has("clip:templates:read")) abilities.push("同步剪藏模板");
  if (permissions.has("clip:templates:write")) abilities.push("保存剪藏模板");

  return [
    "请连接我的 Menote 笔记库。",
    `MCP 服务地址 ${endpoint}`,
    "传输方式 Streamable HTTP",
    `Authorization: Bearer ${secret}`,
    "",
    `令牌范围为${token.scope.mode === "all" ? "账号内可见内容" : "指定主题或分组"}，${token.includeMemos ? "包含 Memo" : "不包含 Memo"}。`,
    "按当前令牌配置，预计可用的能力如下。实际以服务的 tools/list 为准。",
    ...abilities.map((ability) => `- ${ability}`),
    "",
    "请先验证连接并发现工具，用中文告诉我可以做什么，再给出一个用法示例。收到我的具体任务后再访问笔记或执行写入。",
    "此 Token 仅用于上述地址的认证。请在回复中隐藏 Token。",
  ].join("\n");
}

export async function copyMcpConnectionPrompt(endpoint: string, token: McpTokenView): Promise<void> {
  const clipboard = navigator.clipboard;
  if (!clipboard) throw new DOMException("Clipboard unavailable", "NotAllowedError");
  const prompt = revealMcpToken(token.id).then((secret) => formatPrompt(endpoint, secret, token));
  if (typeof ClipboardItem === "undefined" || typeof clipboard.write !== "function") {
    await clipboard.writeText(await prompt);
    return;
  }
  // 保留点击时的剪贴板授权，让浏览器等待复显请求返回文本。
  const data = prompt.then((text) => new Blob([text], { type: "text/plain" }));
  const item = new ClipboardItem({ "text/plain": data });
  await Promise.all([data, clipboard.write([item])]);
}
