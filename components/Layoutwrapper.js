"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { Navbar03 } from "@/components/ui/shadcn-io/navbar-03";

export default function LayoutWrapper({ children }) {
  const pathname = usePathname();

  // หน้าไหนไม่อยากให้มี Navbar ใส่ไว้ตรงนี้
  const noNavbarRoutes = ["/booth"];
  const hideNavbar = noNavbarRoutes.includes(pathname);

  // ค่าเริ่มต้นของ Navbar (ทั้งไซต์)
  const base = React.useMemo(
    () => ({
      //className: "bg-transparent border-none",
      //logoImageSrc: "/image/saturuLogo.jpg",
      //logoHref: "/",
      showLogout: true,
      //logoutLabel: "ออกจากระบบ",
      logoutRedirectPath: "/booth",
      logoutClearKeys: ["pcc_user_phone", "pcc_user_pin"],
      enableAutoLogout: false,
      autoLogoutMs: 5 * 60 * 1000,
      autoLogoutWarnAt: 20,
      autoLogoutPlayUrl: undefined,
    }),
    []
  );

  // คอนฟิกที่ตั้ง “รายหน้า”
  const [runtimeCfg, setRuntimeCfg] = React.useState({});

  React.useEffect(() => {
    const onSet = (e) => setRuntimeCfg(e.detail || {});
    const onReset = () => setRuntimeCfg({});
    window.addEventListener("navbar:set", onSet);
    window.addEventListener("navbar:reset", onReset);
    return () => {
      window.removeEventListener("navbar:set", onSet);
      window.removeEventListener("navbar:reset", onReset);
    };
  }, []);

  // รวมค่าพื้นฐาน + รายหน้า
  const cfg = { ...base, ...runtimeCfg };

  if (hideNavbar) {
    // หน้าที่ไม่ต้องมี Navbar (เช่น /booth)
    return <div className="min-h-screen flex flex-col">{children}</div>;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar03
        className={cfg.className}
        logoImageSrc={cfg.logoImageSrc}
        logoHref={cfg.logoHref}
        showLogout={cfg.showLogout}
        logoutLabel={cfg.logoutLabel}
        logoutRedirectPath={cfg.logoutRedirectPath}
        logoutClearKeys={cfg.logoutClearKeys}
        enableAutoLogout={cfg.enableAutoLogout}
        autoLogoutMs={cfg.autoLogoutMs}
        autoLogoutWarnAt={cfg.autoLogoutWarnAt}
        autoLogoutPlayUrl={cfg.autoLogoutPlayUrl}
      />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
