// app/layout.js
import { ThemeProvider } from "@/components/themeprovider";
import "./globals.css";
import React from "react";
import LayoutWrapper from "@/components/Layoutwrapper";
import { Toaster } from "sonner"; // ✅ ใช้ sonner แทน toast เดิม
import NextSessionProvider from "@/components/sessionProvider";

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
        <NextSessionProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <LayoutWrapper>{children}</LayoutWrapper>
            <Toaster
              richColors
              closeButton
              position="top-center"
              expand={false}
              duration={3000}
            />
          </ThemeProvider>
        </NextSessionProvider>
      </body>
    </html>
  );
}
