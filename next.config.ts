// next.config.ts
import type { NextConfig } from "next";

// ----- Read ENV (for Nextcloud image domains) -----
const PROTO_ENV = process.env.NEXTCLOUD_SERVER_PROTOCOL;
const PROTO: "http" | "https" = PROTO_ENV === "https" ? "https" : "http";
const LINK = process.env.NEXTCLOUD_SERVER_LINK || "";
const PORT = process.env.NEXTCLOUD_SERVER_PORT || "";

// Normalize hostname from LINK (accept URL or raw hostname)
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

// ----- Remote patterns (no undefined on `port`) -----
const remotePatterns: NonNullable<NextConfig["images"]>["remotePatterns"] = [
  {
    protocol: PROTO,
    hostname: HOST,
    pathname: "/**",
    ...(PORT ? { port: PORT } : {}),
  },
];

const nextConfig: NextConfig = {
  // Proxy ไป backend ต่าง ๆ ด้วย path prefix
  async rewrites() {
    return [
      { source: "/mapi/:path*",  destination: process.env.NEXT_PUBLIC_MONGO_BASE  || "http://localhost:2000/:path*" },
      { source: "/ncapi/:path*", destination: process.env.NEXT_PUBLIC_NC_BASE     || "http://localhost:1000/:path*" },
      { source: "/smtpapi/:path*", destination: process.env.NEXT_PUBLIC_SMTP_BASE || "http://localhost:4000/:path*" },
    ];
  },

  // ส่งค่า env ไปฝั่ง client (build-time) — ใช้ค่า .env ถ้ามี, ไม่งั้น fallback เป็น proxy path
  env: {
    NEXT_PUBLIC_MONGO_API: process.env.NEXT_PUBLIC_MONGO_API || "/mapi",
    NEXT_PUBLIC_NC_API:    process.env.NEXT_PUBLIC_NC_API    || "/ncapi",
    NEXT_PUBLIC_SMTP_API:  process.env.NEXT_PUBLIC_SMTP_API  || "/smtpapi",
    NEXT_PUBLIC_NC_BASE:   process.env.NEXT_PUBLIC_NC_BASE   || "/ncapi",
  },

  images: { remotePatterns },
};

export default nextConfig;
