// next.config.ts
import type { NextConfig } from "next";

// ----- Read ENV -----
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
  async rewrites() {
    return [
      { source: "/mapi/:path*", destination: "http://localhost:2000/:path*" },
      { source: "/ncapi/:path*", destination: "http://localhost:1000/:path*" },
    ];
  },
  images: { remotePatterns },
};

export default nextConfig;
