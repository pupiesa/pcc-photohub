// components/dashboard/ui/GalleryLightboxCard.js
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useInView } from "react-intersection-observer";
import { Loader } from "@/components/ui/shadcn-io/ai/loader";

/* ---------- helpers ---------- */
const IMAGE_RE = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;

const buildProxyPreview = (relPath, size = 300, q = 72) =>
  `/ncapi/api/nextcloud/preview?path=${encodeURIComponent(relPath)}&width=${size}&height=${size}&quality=${q}`;

function deriveRelPath(it) {
  if (it?.path) return String(it.path).replace(/^\/+/, "");
  try {
    if (it?.previewUrl) {
      const u = new URL(it.previewUrl);
      const f = u.searchParams.get("file");
      if (f) return decodeURIComponent(f).replace(/^\/+/, "");
    }
  } catch {}
  try {
    if (it?.downloadUrl) {
      const u = new URL(it.downloadUrl);
      const p = u.searchParams.get("path");
      const files = u.searchParams.get("files");
      if (files) {
        const dir = p ? decodeURIComponent(p).replace(/^\/+/, "") : "";
        return dir ? `${dir}/${files}` : files;
      }
    }
  } catch {}
  return String(it?.name || "").replace(/^\/+/, "");
}

/* ---------- lightweight prefetch ของรูปใหญ่ ---------- */
const preloaded = new Set();
function preloadBig(rel, size = 1400) {
  if (!rel || preloaded.has(rel)) return;
  const img = new window.Image();
  img.src = buildProxyPreview(rel, size, 80);
  preloaded.add(rel);
}

/* ---------- Preview ---------- */
function ProxyPreview({ item, eager = false, onClick, onHoverPrefetch }) {
  const { ref, inView } = useInView({ triggerOnce: true, rootMargin: "300px" });
  const rel = deriveRelPath(item);
  if (!rel) return <div className="w-full aspect-square rounded-xl bg-gray-200/20 dark:bg-gray-700/30" />;

  const src = buildProxyPreview(rel, 250, 70);

  return (
    <div
      ref={ref}
      className="relative w-full aspect-square"
      onMouseEnter={() => onHoverPrefetch?.(rel)}
      onTouchStart={() => onHoverPrefetch?.(rel)}
    >
      {inView ? (
        <Image
          src={src}
          alt={item?.name || "preview"}
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 20vw"
          className="object-cover select-none rounded-xl"
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          unoptimized
          draggable={false}
          onClick={onClick}
        />
      ) : (
        <div className="w-full h-full rounded-xl bg-gray-200/20 dark:bg-gray-700/30" />
      )}
    </div>
  );
}

/* ---------- Photo Card ---------- */
function PhotoCard({ item, isNew, onClick, eager }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={item?.name}
      className={[
        "group relative overflow-hidden rounded-xl border",
        "border-gray-200 dark:border-gray-700",
        "transition-transform duration-150 will-change-transform",
        "hover:scale-[1.015] hover:shadow-md active:scale-[0.995] focus:outline-none",
      ].join(" ")}
    >
      {isNew && (
        <span className="absolute top-2 left-2 z-10 animate-pulse px-2 py-0.5 text-[10px] font-bold rounded-full bg-rose-500 text-white shadow">
          NEW
        </span>
      )}
      <ProxyPreview
        item={item}
        eager={eager}
        onClick={onClick}
        onHoverPrefetch={(rel) => preloadBig(rel, 1200)}
      />
    </button>
  );
}

/* ---------- Infinite Scroll helper ---------- */
const PAGE_SIZE = 40;
function useInfiniteInScrollArea({ rootRef, hasMore, loadMore, margin = "200px" }) {
  const sentinelRef = useRef(null);
  useEffect(() => {
    if (!rootRef.current || !sentinelRef.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first?.isIntersecting && hasMore) loadMore();
      },
      { root: rootRef.current, rootMargin: margin, threshold: 0.01 }
    );
    io.observe(sentinelRef.current);
    return () => io.disconnect();
  }, [rootRef, hasMore, loadMore, margin]);
  return { sentinelRef };
}

/* ---------- Lightbox ---------- */
function Lightbox({ open, onOpenChange, items, index }) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const current = items[index];
  const rel = current ? deriveRelPath(current) : null;

  // ใช้ 1400px สำหรับจอทั่วไป ถ้าต้องการคมกว่านี้ค่อยขยับเป็น 1600–2000
  const bigSrc = rel ? buildProxyPreview(rel, 1400, 80) : null;

  useEffect(() => setImgLoaded(false), [bigSrc, open]);

  useEffect(() => {
    if (!open) return;
    if (rel) preloadBig(rel, 1400);
    if (items.length > index + 1) {
      const nextRel = deriveRelPath(items[index + 1]);
      if (nextRel) preloadBig(nextRel, 1200);
    }
  }, [open, index, items, rel]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={[
          "max-w-[92vw] md:max-w-5xl p-0 border-0 bg-transparent shadow-none",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
        ].join(" ")}
      >
        <DialogTitle className="sr-only">Photo preview</DialogTitle>

        <div className="relative w-full aspect-[4/3] md:aspect-video bg-black/90 rounded-2xl overflow-hidden flex items-center justify-center">
          {!imgLoaded && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader className="h-8 w-8 text-white" />
            </div>
          )}

          {bigSrc && (
            <Image
              src={bigSrc}
              alt={current?.name || "photo"}
              fill
              className="object-contain"
              sizes="(max-width: 1024px) 92vw, 80vw"
              unoptimized
              priority
              decoding="async"
              draggable={false}
              onLoadingComplete={() => setImgLoaded(true)}
            />
          )}

          {/* ปุ่มปิด */}
          <div className="absolute bottom-3 inset-x-0 flex items-center justify-center">
            <Button
              variant="secondary"
              size="icon"
              className="rounded-full bg-red-600 hover:bg-black/70"
              onClick={() => onOpenChange(false)}
              aria-label="Close"
            >
              <span className="block leading-none text-white text-lg">&times;</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Card รวม ---------- */
export default function GalleryLightboxCard({
  title = "Photos",
  description = "",
  gallery = [],
  heightClass = "h-[50vh]",
}) {
  const onlyImages = useMemo(
    () => gallery.filter((it) => IMAGE_RE.test(String(it?.name || ""))),
    [gallery]
  );

  const scrollRef = useRef(null);
  const [page, setPage] = useState(1);
  const visible = useMemo(
    () => onlyImages.slice(0, page * PAGE_SIZE),
    [onlyImages, page]
  );
  const hasMore = visible.length < onlyImages.length;
  const loadMore = useCallback(() => setPage((p) => p + 1), []);
  const { sentinelRef } = useInfiniteInScrollArea({
    rootRef: scrollRef,
    hasMore,
    loadMore,
  });

  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const openAt = useCallback((i) => {
    setIndex(i);
    setOpen(true);
  }, []);

  return (
    <>
      <Card className="md:col-span-2 order-2 md:order-1">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          {visible.length === 0 ? (
            <div className="text-sm text-gray-500">No photos</div>
          ) : (
            <ScrollArea ref={scrollRef} className={`${heightClass} pr-2`}>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {visible.map((it, idx) => (
                  <PhotoCard
                    key={`${it.name || it.path || "item"}-${idx}`}
                    item={it}
                    isNew={idx < 2}
                    eager={idx < 4} // 4 รูปแรกโหลดแบบ eager ให้รู้สึกไว
                    onClick={() => openAt(idx)}
                  />
                ))}
              </div>
              {hasMore && <div ref={sentinelRef} className="h-8 w-full" />}
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <Lightbox open={open} onOpenChange={setOpen} items={visible} index={index} />
    </>
  );
}
