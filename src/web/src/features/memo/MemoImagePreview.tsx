import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "../../icons";

export interface MemoImagePreviewData {
  src: string;
  alt: string;
}

/** Timeline image preview; the authenticated attachment URL is reused without creating a thumbnail cache. */
export function MemoImagePreview({ image, onClose }: { image: MemoImagePreviewData; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      restoreFocus?.focus();
    };
  }, []);

  const title = image.alt.trim() || "图片预览";
  return createPortal(
    <div className="mn-overlay mn-memo-image-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="mn-dialog mn-memo-image-dialog" role="dialog" aria-modal="true" aria-label={`图片预览：${title}`}>
        <header className="mn-dialog-head mn-memo-image-head">
          <h2 className="mn-dialog-title">{title}</h2>
          <button ref={closeRef} type="button" className="mn-iconbtn" aria-label="关闭图片预览" onClick={onClose}><X aria-hidden="true" /></button>
        </header>
        <div className="mn-memo-image-stage"><img src={image.src} alt={image.alt} /></div>
      </section>
    </div>,
    document.body,
  );
}
