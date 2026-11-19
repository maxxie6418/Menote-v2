import { useEffect, useState, type ReactNode } from "react";
import { isRasterAttachment } from "../../lib/attachmentRefs";
import { isNoteUnlocked, subscribeLockState } from "../../services/keyringService";
import { readUnlockedAttachment } from "../../services/sealedAttachmentService";

interface Props { itemId: string; sha256: string; name: string; image?: boolean; children?: ReactNode }

/** Decrypted object URLs are visible only while their note is unlocked and the element is mounted. */
export function UnlockedAttachment({ itemId, sha256, name, image, children }: Props) {
  const [open, setOpen] = useState<{ token: string; url?: string; legacy?: boolean }>();
  const token = `${itemId}:${sha256}:${Boolean(image)}`;
  useEffect(() => {
    const abort = new AbortController();
    let url: string | undefined;
    const clear = () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
    const unsubscribe = subscribeLockState(() => {
      if (isNoteUnlocked(itemId)) return;
      clear();
      setOpen(undefined);
    });
    void readUnlockedAttachment(itemId, sha256, abort.signal).then(({ blob, sealed }) => {
      if (abort.signal.aborted) return;
      if (image && !isRasterAttachment(blob.type)) {
        setOpen({ token, legacy: !sealed });
        return;
      }
      url = URL.createObjectURL(image ? blob : new Blob([blob], { type: "application/octet-stream" }));
      setOpen({ token, url, legacy: !sealed });
    }).catch(() => { if (!abort.signal.aborted) setOpen({ token }); });
    return () => { unsubscribe(); clear(); };
  }, [token, itemId, sha256, image]);
  const resolved = open?.token === token ? open : undefined;
  if (!resolved) return <span role="status">正在打开附件…</span>;
  return <>
    {resolved.url
      ? image ? <img src={resolved.url} alt={name} loading="lazy" /> : <a href={resolved.url} download={name}>{children ?? name}</a>
      : <span role="status">附件无法预览或下载</span>}
    {resolved.legacy && <small>（旧版明文附件）</small>}
  </>;
}
