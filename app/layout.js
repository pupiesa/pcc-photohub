import "./globals.css";
import React from "react";

export const metadata = {
  title: "PCC Photo Hub",
  description: "photo booth application with live camera preview and capture",
  keywords: "photo booth, camera, photography, capture, live preview",
  authors: [{ name: "Pcc-Photohub" }],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body>{children}</body>
    </html>
  );
}
