import { useEffect, useRef, useState } from "react";
import { attachmentUrl } from "../../services/attachmentService";
import type { MemoImage } from "./memoView";

interface MemoGalleryProps {
  images: MemoImage[];
  onOpen: (memoId: string) => void;
}

/** 图册（FR-MEMO-6）：同一批 Memo 图片的另一种排布。点图回到原条目，不产生第二份状态。 */
export function MemoGallery({ images, onOpen }: MemoGalleryProps) {
  if (images.length === 0) {
    return (
      <div className="mn-empty" role="status">
        <div>
          <p className="mn-empty-title">还没有图片</p>
          <p className="mn-empty-detail">Memo 里的图片会出现在这里，点开回到原来那一条。</p>
        </div>
      </div>
    );
  }
  return (
    <div className="mn-memo-gallery">
      {images.map((image) => (
        <GalleryItem key={`${image.memoId}-${image.sha256}`} image={image} onOpen={onOpen} />
      ))}
    </div>
  );
}

function GalleryItem({ image, onOpen }: { image: MemoImage; onOpen: (memoId: string) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [ratio, setRatio] = useState<number | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
    }, { rootMargin: "12rem" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <button ref={ref} type="button" className="mn-memo-gal-item" onClick={() => onOpen(image.memoId)}>
      <span className="mn-memo-gal-thumb" data-loaded={ratio !== null} style={ratio ? { aspectRatio: String(ratio) } : undefined}>
        {visible && (
          <img
            src={attachmentUrl(image.sha256)}
            alt=""
            onLoad={(event) => {
              const img = event.currentTarget;
              if (img.naturalWidth > 0) setRatio(img.naturalWidth / img.naturalHeight);
            }}
          />
        )}
      </span>
      <span className="mn-memo-gal-cap">
        <time>{new Date(image.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</time>
        {image.tag && <span>#{image.tag}</span>}
      </span>
    </button>
  );
}
