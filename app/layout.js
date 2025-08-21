import { ThemeProvider } from "@/components/themeprovider";
import "./globals.css";
import React from "react";
import { Navbar03 } from "@/components/ui/shadcn-io/navbar-03";

export const metadata = {
  title: "PCC Photo Hub",
  description: "photo booth application with live camera preview and capture",
  keywords: "photo booth, camera, photography, capture, live preview",
  authors: [{ name: "Pcc-Photohub" }],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
