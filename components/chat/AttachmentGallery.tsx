'use client';

import { useEffect, useRef, useState } from 'react';
import { ImageIcon, X } from 'lucide-react';
import type { ImageAttachment } from '@/types/attachment';
import { getAttachment } from '@/lib/attachments/client-store';

export function AttachmentGallery({ attachments, compact = false, onRemove }: {
  attachments: ImageAttachment[];
  compact?: boolean;
  onRemove?: (attachment: ImageAttachment) => void;
}) {
  const [urls, setUrls] = useState<Record<string, string>>(() => Object.fromEntries(attachments.filter((item) => item.previewUrl).map((item) => [item.id, item.previewUrl!])))
  const [preview, setPreview] = useState<ImageAttachment | null>(null);
  const createdUrls = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(attachments.filter((item) => !item.previewUrl && !urls[item.id]).map(async (attachment) => {
      const blob = await getAttachment(attachment.id).catch(() => null);
      if (!blob || cancelled) return;
      const url = URL.createObjectURL(blob);
      createdUrls.current.push(url);
      setUrls((current) => ({ ...current, [attachment.id]: url }));
    }));
    return () => { cancelled = true; };
    // Existing object URLs are intentionally excluded; this effect only loads missing persisted blobs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments]);

  useEffect(() => () => {
    createdUrls.current.forEach((url) => URL.revokeObjectURL(url));
    createdUrls.current = [];
  }, []);

  if (!attachments.length) return null;
  return (
    <>
      <div className={`attachment-grid ${compact ? 'compact' : ''}`} style={{ '--attachment-count': Math.min(attachments.length, 4) } as React.CSSProperties}>
        {attachments.map((attachment) => {
          const url = attachment.previewUrl ?? urls[attachment.id];
          return (
            <figure key={attachment.id} style={{ aspectRatio: `${Math.max(1, attachment.width)} / ${Math.max(1, attachment.height)}` }}>
              {url ? (
                <button type="button" onClick={() => setPreview(attachment)} aria-label={`Open ${attachment.name}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- Blob URLs cannot use the Next image optimizer. */}
                  <img src={url} alt={attachment.name} loading="lazy" />
                </button>
              ) : <span className="attachment-loading"><ImageIcon size={18} /> Loading image…</span>}
              {onRemove && <button type="button" className="attachment-remove" onClick={() => onRemove(attachment)} aria-label={`Remove ${attachment.name}`}><X size={13} /></button>}
              {!compact && <figcaption>{attachment.name}</figcaption>}
            </figure>
          );
        })}
      </div>
      {preview && (
        <div className="image-preview-dialog" role="dialog" aria-modal="true" aria-label={preview.name} onClick={() => setPreview(null)}>
          <button className="image-preview-close" onClick={() => setPreview(null)} aria-label="Close image preview"><X size={20} /></button>
          {(preview.previewUrl ?? urls[preview.id]) && (
            /* eslint-disable-next-line @next/next/no-img-element -- Blob URLs cannot use the Next image optimizer. */
            <img src={preview.previewUrl ?? urls[preview.id]} alt={preview.name} onClick={(event) => event.stopPropagation()} />
          )}
        </div>
      )}
    </>
  );
}
