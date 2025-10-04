"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Navbar03 } from "@/components/ui/shadcn-io/navbar-03";
import { ChevronLeft, ChevronRight } from "lucide-react";

const BGGradient = dynamic(
  async () => {
    const mod = await import("@/components/ui/shadcn-io/background-gradient-animation");
    return "default" in mod ? mod.default : mod.BackgroundGradientAnimation;
  },
  { ssr: false }
);

// ข้อมูลสินค้า
const PRODUCTS = [
  { name: "Print 4x6 (Glossy)", price: "฿50", image: "/image/collection/overlay.png", newproduct: true},
  { name: "Print 4x6 (Matte)", price: "฿55", image: "/image/about/saturuLogo.jpg" },
  { name: "Print 4x6 (Premium)", price: "฿50", image: "/image/about/saturuLogo.jpg" },
  { name: "Print 4x6 (Special Edition)", price: "฿50", image: "/image/about/saturuLogo.jpg"},
  { name: "Print 4x6 (Special Edition)", price: "฿50", image: "/image/about/saturuLogo.jpg" },
  { name: "Print 4x6 (Special Edition)", price: "฿50", image: "/image/about/saturuLogo.jpg" },
  { name: "Print 4x6 (Special Edition)", price: "฿50", image: "/image/about/saturuLogo.jpg" },
];

export default function CollectionPage() {
  const areaRef = useRef(null);
  const scrollByCards = useCallback((dir = 1) => {
    const viewport = areaRef.current?.querySelector("[data-scrollviewport]");
    if (!viewport) return;
    const firstCard = viewport.querySelector("[data-card]");
    const amount = firstCard ? firstCard.getBoundingClientRect().width + 24 : 260;
    viewport.scrollBy({ left: dir * amount, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const viewport = areaRef.current?.querySelector("[data-scrollviewport]");
    if (!viewport) return;

    const onWheel = (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        viewport.scrollLeft += e.deltaY;
      }
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        scrollByCards(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        scrollByCards(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scrollByCards]);

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden text-zinc-100">
      {/* BG */}
      <div className="absolute inset-0 -z-10">
        <BGGradient className="absolute inset-0" />
      </div>

      <Navbar03
        className="bg-transparent border-none"
        /* ปุ่ม Logout */
        showLogout
        logoutRedirectPath="/booth"
        logoutClearKeys={["pcc_user_phone","pcc_user_pin"]}

        /* Auto-Logout ต่อหน้านี้ */
        enableAutoLogout
        autoLogoutMs={2 * 60 * 1000}        // 2 นาที
        autoLogoutWarnAt={20}               // เตือน 20s สุดท้าย 
        autoLogoutPlayUrl={`http://127.0.0.1:5000/play/thankyou.wav`}
      />

      {/* Header */}
      <header className="pt-8 pb-4 px-6 flex flex-col items-center">
        <Image
          src="/image/saturuLogo.jpg"
          alt="Logo"
          width={110}
          height={110}
          className="rounded-full ring-2 ring-white/30 shadow-2xl shadow-black/50"
          priority
        />
        <h1 className="mt-4 text-xl md:text-2xl font-semibold">Collection</h1>
        <p className="text-sm text-zinc-200/90 text-center max-w-[60ch]">
          รวมรูปแบบภาพ 4×6 นิ้ว ให้คุณสะสม
        </p>
        <p className="mt-2 text-xs text-zinc-300/80 select-none">
          ใช้ปุ่ม &larr; &rarr; หรือปุ่มวงกลมซ้าย/ขวาเพื่อเลื่อน
        </p>
      </header>

      {/* แถวการ์ดสินค้า (เลื่อนแนวนอน) */}
      <section className="relative px-6 pb-6 flex-1">
        {/* ขอบ fade ซ้าย/ขวา */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-16 z-10 bg-gradient-to-r from-black/60 to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-16 z-10 bg-gradient-to-l from-black/60 to-transparent" />

        {/* ปุ่มเลื่อน ซ้าย/ขวา */}
        <button
          aria-label="เลื่อนซ้าย"
          onClick={() => scrollByCards(-1)}
          className={cn(
            "group absolute left-4 top-1/2 -translate-y-1/2 z-20",
            "h-12 w-12 md:h-14 md:w-14 rounded-full",
            "bg-white/20 hover:bg-white/30 border border-white/30 backdrop-blur",
            "shadow-xl flex items-center justify-center"
          )}
        >
          <ChevronLeft className="h-6 w-6 md:h-7 md:w-7 text-white drop-shadow" />
          <span className="sr-only">เลื่อนซ้าย</span>
        </button>

        <button
          aria-label="เลื่อนขวา"
          onClick={() => scrollByCards(1)}
          className={cn(
            "group absolute right-4 top-1/2 -translate-y-1/2 z-20",
            "h-12 w-12 md:h-14 md:w-14 rounded-full",
            "bg-white/20 hover:bg-white/30 border border-white/30 backdrop-blur",
            "shadow-xl flex items-center justify-center"
          )}
        >
          <ChevronRight className="h-6 w-6 md:h-7 md:w-7 text-white drop-shadow" />
          <span className="sr-only">เลื่อนขวา</span>
        </button>

        {/* พื้นที่สกอลล์ (ซ่อน scrollbar) */}
        <div
          ref={areaRef}
          className={cn(
            "w-full h-full rounded-2xl ring-1 ring-white/10 backdrop-blur-sm bg-black/10 relative overflow-hidden",
            "[&_[data-scrollviewport]]:h-full",
            "[&_[data-scrollviewport]]:overflow-x-auto",
            "[&_[data-scrollviewport]]:overflow-y-hidden",
            "[&_[data-scrollviewport]]:-ms-overflow-style-none", // IE/Edge
            "[&_[data-scrollviewport]]:scrollbar-width-none",    // Firefox
            "[&_[data-scrollviewport]::-webkit-scrollbar]:hidden" // WebKit
          )}
        >
          <div data-scrollviewport className="h-full">
            <div className="flex gap-6 md:gap-8 p-4 pr-6">
              {PRODUCTS.map((p, i) => (
                <Card
                  key={i}
                  data-card
                  className={cn(
                    "relative w-[260px] md:w-[280px] flex-shrink-0 border-white/10 bg-white/5 backdrop-blur-md",
                    "hover:bg-white/[0.08] transition"
                  )}
                >
                  {p.newproduct && (
                    <Badge className="absolute top-3 right-3 animate-pulse bg-emerald-500 text-white shadow">
                      NEW
                    </Badge>
                  )}

                  <CardContent className="p-4 flex flex-col items-center">
                    <div className="w-[200px] md:w-[220px] aspect-[2/3]">
                      <Image
                        src={p.image}
                        alt={p.name}
                        width={220}
                        height={330}
                        className="h-full w-full rounded-lg object-cover shadow-lg"
                        priority={i < 2}
                      />
                    </div>
                    <h2 className="mt-4 text-base font-medium text-center">{p.name}</h2>
                    <p className="mt-1 text-lg font-semibold text-emerald-400">{p.price}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ซ่อน scrollbar ของ body*/}
      <style jsx global>{`
        html, body {
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}
