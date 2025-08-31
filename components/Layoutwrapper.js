"use client";

import { usePathname } from "next/navigation";
import { Navbar03 } from "@/components/ui/shadcn-io/navbar-03";

export default function LayoutWrapper({ children }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/booth";

  if (isLoginPage) {
    return <div>{children}</div>;
  }

  return (
    <div className="flex flex-col flex-1 min-w-0">
      <div className="relative w-full">
        <Navbar03 />
      </div>
      <main className="p-4 flex-1 min-w-0">{children}</main>
    </div>
  );
}
