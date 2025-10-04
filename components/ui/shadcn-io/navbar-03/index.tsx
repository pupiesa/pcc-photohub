"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "@/components/ui/navigation-menu";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

/* ---------------- Default Logo (fallback) ---------------- */
const DefaultLogo = (props: React.SVGAttributes<SVGElement>) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 324 323"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    {...props}
  >
    <rect
      x="88.1023"
      y="144.792"
      width="151.802"
      height="36.5788"
      rx="18.2894"
      transform="rotate(-38.5799 88.1023 144.792)"
    />
    <rect
      x="85.3459"
      y="244.537"
      width="151.802"
      height="36.5788"
      rx="18.2894"
      transform="rotate(-38.5799 85.3459 244.537)"
    />
  </svg>
);

/* ---------------- Types ---------------- */
export interface Navbar03NavItem {
  href?: string;
  label: string;
  active?: boolean;
  authOnly?: boolean;
}

export interface Navbar03Props extends React.HTMLAttributes<HTMLElement> {
  /** โลโก้เป็น ReactNode เช่น <Image/> หรือ <svg/> */
  logo?: React.ReactNode;
  /** ใช้รูปง่าย ๆ แล้วคอมโพเนนต์จะวาง <Image/> ให้เอง */
  logoImageSrc?: string;
  /** ลิงก์ตอนคลิกโลโก้ */
  logoHref?: string;

  navigationLinks?: Navbar03NavItem[];

  /** แสดงปุ่ม Logout หรือไม่ (default: true) */
  showLogout?: boolean;
  /** ข้อความบนปุ่ม Logout (default: "Logout") */
  logoutLabel?: string;
  /** เส้นทางหลัง Logout (default: "/booth") */
  logoutRedirectPath?: string;
  /** localStorage keys ที่ต้องลบทิ้งตอน Logout (default: ["pcc_user_phone","pcc_user_pin"]) */
  logoutClearKeys?: string[];

  /** ✨ เปิด Auto-Logout ต่อหน้าได้เลย */
  enableAutoLogout?: boolean;
  /** เวลานิ่งไม่โต้ตอบจนล็อกเอาท์ (ms) default: 5 นาที */
  autoLogoutMs?: number;
  /** ช่วงเตือนก่อนหมดเวลา (วินาที) default: 20s */
  autoLogoutWarnAt?: number;
  /** เล่นเสียงตอนจะออก (optional) เช่น `http://127.0.0.1:5000/play/thankyou.wav` */
  autoLogoutPlayUrl?: string;
}

/* --------- Default routes --------- */
const defaultNavigationLinks: Navbar03NavItem[] = [
  { href: "/dashboard", label: "Gallery" },
  { href: "/collection", label: "Collection" },
  { href: "/about", label: "About" },
];

/* --------- helper: assign forwarded refs --------- */
function isMutableRefObject<T>(
  ref: React.ForwardedRef<T>
): ref is React.MutableRefObject<T> {
  return typeof ref === "object" && ref !== null && "current" in ref;
}
function assignRef<T>(ref: React.ForwardedRef<T>, value: T) {
  if (typeof ref === "function") ref(value);
  else if (isMutableRefObject(ref)) ref.current = value;
}

/* ---------------- Navbar ---------------- */
export const Navbar03 = React.forwardRef<HTMLElement, Navbar03Props>(
  (
    {
      className,
      logo,
      logoImageSrc = "/image/PccPhotoboothtLogo.png",
      navigationLinks = defaultNavigationLinks,

      showLogout = true,
      logoutLabel = "Logout",
      logoutRedirectPath = "/booth",
      logoutClearKeys = ["pcc_user_phone", "pcc_user_pin"],

      enableAutoLogout = false,
      autoLogoutMs = 5 * 60 * 1000, // 5 นาที
      autoLogoutWarnAt = 20, // 20s ก่อนหมดเวลา
      autoLogoutPlayUrl,

      ...props
    },
    ref
  ) => {
    const pathname = usePathname();
    const router = useRouter();
    const containerRef = React.useRef<HTMLElement | null>(null);

    const combinedRef = React.useCallback(
      (node: HTMLElement | null) => {
        containerRef.current = node;
        assignRef(ref, node as HTMLElement);
      },
      [ref]
    );

    const isActive = (href?: string) => {
      if (!href) return false;
      if (href === "/") return pathname === "/";
      return pathname === href || pathname.startsWith(href + "/");
    };

    /* ---------------- Logout core ---------------- */
    const handleLogout = React.useCallback(() => {
      try {
        logoutClearKeys.forEach((k) => localStorage.removeItem(k));
      } catch {}
      if (autoLogoutPlayUrl) {
        try {
          fetch(autoLogoutPlayUrl).catch(() => {});
        } catch {}
      }
      router.push(logoutRedirectPath);
    }, [logoutClearKeys, logoutRedirectPath, router, autoLogoutPlayUrl]);

    /* ---------------- Idle timer (per-page) ---------------- */
    const [secondsLeft, setSecondsLeft] = React.useState<number | null>(null);
    const deadlineRef = React.useRef<number>(0);

    const resetIdle = React.useCallback(() => {
      if (!enableAutoLogout) return;
      deadlineRef.current = Date.now() + autoLogoutMs;
      setSecondsLeft(Math.ceil(autoLogoutMs / 1000));
    }, [enableAutoLogout, autoLogoutMs]);

    React.useEffect(() => {
      if (!enableAutoLogout) return;

      // window events ที่รองรับโดย WindowEventMap
      const WINDOW_IDLE_EVENTS: ReadonlyArray<keyof WindowEventMap> = [
        "pointerdown",
        "keydown",
        "mousemove",
        "wheel",
        "touchstart",
        "scroll",
      ];

      const onWindowInteract = (_e: Event) => {
        if (document.visibilityState === "visible") resetIdle();
      };
      const onVisibilityChange = (_e: Event) => {
        if (document.visibilityState === "visible") resetIdle();
      };

      const passiveOpts: AddEventListenerOptions = { passive: true };

      WINDOW_IDLE_EVENTS.forEach((ev) =>
        window.addEventListener(ev, onWindowInteract, passiveOpts)
      );
      document.addEventListener("visibilitychange", onVisibilityChange);

      resetIdle();

      const id = window.setInterval(() => {
        const ms = Math.max(0, deadlineRef.current - Date.now());
        const s = Math.max(0, Math.ceil(ms / 1000));
        setSecondsLeft(s);
        if (s <= 0) {
          window.clearInterval(id);
          WINDOW_IDLE_EVENTS.forEach((ev) =>
            window.removeEventListener(ev, onWindowInteract, passiveOpts)
          );
          document.removeEventListener("visibilitychange", onVisibilityChange);
          handleLogout();
        }
      }, 1000);

      return () => {
        window.clearInterval(id);
        WINDOW_IDLE_EVENTS.forEach((ev) =>
          window.removeEventListener(ev, onWindowInteract, passiveOpts)
        );
        document.removeEventListener("visibilitychange", onVisibilityChange);
      };
    }, [enableAutoLogout, resetIdle, handleLogout]);

    /* ---------------- Logo node ---------------- */
    const LogoNode = React.useMemo(() => {
      if (logo) return logo;
      if (logoImageSrc) {
        return (
          <Image
            src={logoImageSrc}
            alt="Logo"
            width={24}
            height={24}
            className="rounded-md"
            priority
          />
        );
      }
      return <DefaultLogo />;
    }, [logo, logoImageSrc]);

    return (
      <>
        <header
          ref={combinedRef}
          className={cn("w-full z-50", className)}
          {...props}
        >
          <div className="container mx-auto flex h-14 items-center justify-between gap-4 px-4">
            {/* Logo */}
            <div className="flex items-center gap-2">
              <span className="text-xl">{LogoNode}</span>
              <span className="font-semibold text-lg sm:inline-block">
                Pcc-photohub
              </span>
            </div>

            {/* Right zone */}
            <div className="flex items-center gap-3">
              {/* Desktop nav */}
              <NavigationMenu className="hidden md:block">
                <NavigationMenuList className="gap-2">
                  {navigationLinks
                    .filter((l) => !l.authOnly)
                    .map((link) => {
                      const active = isActive(link.href);
                      return (
                        <NavigationMenuItem key={link.href}>
                          <NavigationMenuLink
                            asChild
                            className={cn(
                              "inline-flex h-8 items-center rounded-md px-3 py-1 text-sm font-medium transition-colors hover:text-primary focus:outline-none",
                              active && "text-primary font-semibold"
                            )}
                            data-active={active}
                          >
                            <Link href={link.href || "#"}>{link.label}</Link>
                          </NavigationMenuLink>
                        </NavigationMenuItem>
                      );
                    })}
                </NavigationMenuList>
              </NavigationMenu>

              {/* Logout button — premium style */}
              {showLogout && (
                <button
                  onClick={handleLogout}
                  aria-label={logoutLabel}
                  className={cn(
                    "relative inline-flex h-9 items-center justify-center rounded-full px-4 text-sm font-semibold text-white",
                    "transition-all focus:outline-none focus:ring-2 focus:ring-white/40",
                    // core gradient + glow
                    "bg-gradient-to-r from-fuchsia-500 via-pink-500 to-amber-400",
                    "hover:from-fuchsia-600 hover:via-pink-600 hover:to-amber-500",
                    "shadow-[0_8px_30px_rgba(240,46,170,0.35)] border border-white/30 backdrop-blur",
                    // shimmering sweep
                    "before:absolute before:inset-0 before:rounded-full before:p-[1px] before:bg-[linear-gradient(110deg,rgba(255,255,255,.7),rgba(255,255,255,0)_45%,rgba(255,255,255,.7))] before:opacity-20 before:animate-[shimmer_2.2s_linear_infinite]",
                    "active:scale-95"
                  )}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  {logoutLabel}
                </button>
              )}
            </div>
          </div>
        </header>

        {/* 🔔 Idle countdown banner (fixed bottom) */}
        {enableAutoLogout &&
          typeof secondsLeft === "number" &&
          secondsLeft > 0 &&
          secondsLeft <= autoLogoutWarnAt && (
            <div className="fixed bottom-4 inset-x-0 z-[60] flex justify-center pointer-events-none">
              <div className="pointer-events-auto px-4 py-2 rounded-full bg-black/70 text-red-400 text-sm shadow-lg backdrop-blur border border-white/20">
                ไม่มีการใช้งาน — จะออกจากระบบอัตโนมัติใน{" "}
                <span className="font-bold">{secondsLeft}</span>s
              </div>
            </div>
          )}
      </>
    );
  }
);

Navbar03.displayName = "Navbar03";
