import { attachmentUrl } from "../../services/attachmentService";

const REF = /attachments\/([0-9a-f]{64})--([^\s)\\]+)/g;
const URL_REF = /\/api\/attachments\/([0-9a-f]{64})/g;

/**
 * 编辑器只认能直接加载的地址（FR-EDT-7）。相对引用与鉴权 URL 的对应关系记在
 * 调用方持有的对照表里：喂进编辑器前替换，取出时按哈希还原成相对路径。
 * 持久层不出现鉴权地址（C-1）。对照表里没有的哈希保持原样，不猜测文件名。
 */
export function toEditorMarkdown(markdown: string, names: Map<string, string>): string {
  return markdown.replace(REF, (whole, sha: string, name: string) => {
    names.set(sha, name);
    return attachmentUrl(sha);
  });
}

export function fromEditorMarkdown(markdown: string, names: Map<string, string>): string {
  return markdown.replace(URL_REF, (url, sha: string) => {
    const name = names.get(sha);
    return name ? `attachments/${sha}--${name}` : url;
  });
}
