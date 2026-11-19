import type { Node } from "@milkdown/kit/prose/model";
import type { NodeView } from "@milkdown/kit/prose/view";
import { isRasterAttachment, parseAttachmentDestination } from "../../lib/attachmentRefs";
import { isNoteUnlocked, subscribeLockState } from "../../services/keyringService";
import { readUnlockedAttachment } from "../../services/sealedAttachmentService";

/** Keep Markdown paths in ProseMirror. The decrypted blob URL exists only in the DOM. */
export function unlockedImageView(node: Node, itemId: string): NodeView {
  const dom = document.createElement("img");
  dom.alt = String(node.attrs.alt ?? "");
  dom.title = String(node.attrs.title ?? "");
  dom.loading = "lazy";
  const src = String(node.attrs.src ?? "");
  const attachment = parseAttachmentDestination(src);
  if (!attachment) {
    // Preserve the editor's normal handling of images that are not Menote attachments.
    if (/^https?:\/\//i.test(src)) dom.src = src;
    return { dom };
  }
  const abort = new AbortController();
  let url: string | undefined;
  const clear = () => {
    abort.abort();
    if (url) URL.revokeObjectURL(url);
    dom.removeAttribute("src");
  };
  const unsubscribe = subscribeLockState(() => { if (!isNoteUnlocked(itemId)) clear(); });
  void readUnlockedAttachment(itemId, attachment.sha256, abort.signal).then(({ blob, sealed }) => {
    if (abort.signal.aborted || !isRasterAttachment(blob.type)) return;
    url = URL.createObjectURL(blob);
    dom.src = url;
    if (!sealed) dom.title = "旧版明文附件";
  }).catch(() => { if (!abort.signal.aborted) dom.title = "附件无法预览"; });
  return { dom, ignoreMutation: () => true, destroy: () => { unsubscribe(); clear(); } };
}
