"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { useEffect } from "react";
const BGBeams = dynamic(
  async () => {
    const mod = await import("@/components/ui/shadcn-io/background-beams-with-collision");
    return "default" in mod ? mod.default : mod.BackgroundBeamsWithCollision;
  },
  { ssr: false }
);

const PEOPLE = [
  {
    side: "left",
    name: "Dusakorn Tubsang",
    title: "Founder & Lead Developer",
    desc:
      "Fontend Stripe QR-PromptPay",
    image: "/image/about/IMG1.webp"
  },
  {
    side: "right",
    name: "Chanapongpans Submee",
    title: "Co-founder & Operations",
    desc:
      "Imagecloud DataBase API Backend",
    image: "/image/about/IMG2.webp"
  },
  {
    side: "left",
    name: "Sahakiat Kanchanarat",
    title: "CTO & Infrastructure",
    desc:
      "SystemHardware  Micro-APIs  3D-printer",
    image: "/image/about/IMG3.webp"
  },
  {
    side: "right",
    name: "Surachat Khongsong",
    title: "Design & Support",
    desc:
      "UI Logo security guard",
    image: "/image/about/IMG4.webp"
  }
];

export default function AboutPage() {
  const leftCol = PEOPLE.filter((p) => p.side === "left");
  const rightCol = PEOPLE.filter((p) => p.side === "right");

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("navbar:set", {
      detail: {
        // ตั้งค่าเฉพาะหน้านี้
        enableAutoLogout: true,
        autoLogoutMs: 2 * 60 * 1000,
        autoLogoutWarnAt: 20,
        autoLogoutPlayUrl: "http://127.0.0.1:5000/play/thankyou.wav",
        showLogout: true,
        logoutRedirectPath: "/booth",
        logoutClearKeys: ["pcc_user_phone", "pcc_user_pin"],
      }
    }));
    return () => {
      window.dispatchEvent(new CustomEvent("navbar:reset"));
    };
  }, []);

  return (
    <div className="relative flex flex-col min-h-[88.5vh] min-w-full bg-black text-zinc-100 overflow-hidden">
      {/* BG */}
      <div className="absolute inset-0 z-0">
        <BGBeams className="absolute inset-0" />
      </div>

      {/* เนื้อหา */}
      <main className="relative z-10 flex flex-col flex-1 items-center justify-start pt-10 pb-12">
        <Image
          src="/image/saturuLogo.webp"
          alt="Logo"
          width={120}
          height={120}
          className="rounded-full ring-2 ring-white/20 shadow-2xl shadow-blue-500"
          priority
        />
        <h1 className="mt-4 text-xl md:text-2xl font-semibold">About Us</h1>
        <div className="text-sm text-zinc-400 text-center max-w-[70ch] mt-1 space-y-1">
          <p><strong>ProjecPccPhotoHub</strong></p>
          <p>Present is a project of 3rd year university student</p>
          <p>King Mongkut's Institute of Technology Ladkrabang Prince of Chumphon Campus</p>
        </div>


        {/* section ขยายเต็ม + จัดให้อยู่กลางแนวตั้ง */}
        <section className="flex-1 flex items-center w-full">
          <div className="mx-auto max-w-6xl w-full px-4 grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
            <div className="flex flex-col gap-6 md:gap-8 ">
              {leftCol.map((p, idx) => (
                <PersonCard key={`l-${idx}`} person={p} />
              ))}
            </div>
            <div className="flex flex-col gap-6 md:gap-8">
              {rightCol.map((p, idx) => (
                <PersonCard key={`r-${idx}`} person={p} />
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function PersonCard({ person }) {
  const { name, title, desc, image } = person || {};
  return (
    <GlassCard>
      <div className={image ? "flex items-start gap-4" : ""}>
        {image && (
          <Image
            src={image}
            alt={name}
            width={96}
            height={96}
            className="size-24 rounded-xl object-cover ring-1 ring-white/15 "
          />
        )}
        <div>
          <h2 className="text-base md:text-lg font-medium">{name}</h2>
          <p className="text-xs md:text-sm text-zinc-300">{title}</p>
          <p className="mt-2 text-sm leading-6 text-zinc-400">{desc}</p>
        </div>
      </div>
    </GlassCard>
  );
}

function GlassCard({ children }) {
  return (
    <div className="rounded-2xl p-5 md:p-6 bg-white/[0.06] backdrop-blur-md ring-1 ring-white/10 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.65)]">
      {children}
    </div>
  );
}