// next.config.ts
import type { NextConfig } from "next";

// ----- Read ENV (for Nextcloud image domains on <Image>) -----
const PROTO_ENV = process.env.NEXTCLOUD_SERVER_PROTOCOL;
const PROTO: "http" | "https" = PROTO_ENV === "https" ? "https" : "http";
const LINK = process.env.NEXTCLOUD_SERVER_LINK || "";
const PORT = process.env.NEXTCLOUD_SERVER_PORT || "";

function toHostname(raw: string): string {
  try {
    if (!raw) return "";
    if (raw.includes("://")) return new URL(raw).hostname;
    return raw.replace(/^https?:\/\//, "").split("/")[0];
  } catch {
    return raw;
  }
}
const HOST = toHostname(LINK) || "localhost";

//ใช้กับ <Image> (โหลดรูปจากโดเมน Nextcloud โดยตรง เมื่อ fallback)
const remotePatterns: NonNullable<NextConfig["images"]>["remotePatterns"] = [
  { protocol: PROTO, hostname: HOST, pathname: "/**", ...(PORT ? { port: PORT } : {}) },
];

// ปลายทาง “จริง” ของ backend (origin) — ใช้กับ rewrites เท่านั้น
const MONGO_API_ORIGIN   = process.env.NEXT_PUBLIC_MONGO_BASE;
const NEXTCLOUD_API_ORIGIN = process.env.NEXT_PUBLIC_NC_BASE;
const SMTP_API_ORIGIN    = process.env.NEXT_PUBLIC_SMTP_BASE;

//path prefix ฝั่งหน้าเว็บ (public base สำหรับ fetch ฝั่ง client)
const NEXT_PUBLIC_MONGO_API = process.env.NEXT_PUBLIC_MONGO_API || "/mapi";
const NEXT_PUBLIC_NC_API    = process.env.NEXT_PUBLIC_NC_API    || "/ncapi";
const NEXT_PUBLIC_SMTP_API  = process.env.NEXT_PUBLIC_SMTP_API  || "/smtpapi";
const NEXT_PUBLIC_NC_BASE   = process.env.NEXT_PUBLIC_NC_BASE   || "/ncapi"; // ใช้ใน page.js

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      //ปลายทางต้องเป็น “origin” ของ backend เท่านั้น อย่าใช้ NEXT_PUBLIC_*
      { source: "/mapi/:path*",   destination: `${MONGO_API_ORIGIN}/:path*` },
      { source: "/ncapi/:path*",  destination: `${NEXTCLOUD_API_ORIGIN}/:path*` },
      { source: "/smtpapi/:path*",destination: `${SMTP_API_ORIGIN}/:path*` },
    ];
  },

  // ส่งค่า env ไปฝั่ง client (ใช้ path prefix เท่านั้น)
  env: {
    NEXT_PUBLIC_MONGO_API,
    NEXT_PUBLIC_NC_API,
    NEXT_PUBLIC_SMTP_API,
    NEXT_PUBLIC_NC_BASE,
  },

  images: { remotePatterns },
};

export default nextConfig;