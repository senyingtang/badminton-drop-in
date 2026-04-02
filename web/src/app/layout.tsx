import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "羽球排組平台 | Badminton Session Manager",
  description: "專為羽球團主打造的臨打場次管理、自動分組、球員管理 SaaS 平台",
  keywords: "羽球, badminton, 排組, 臨打, session, 分組, 管理平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW">
      <body>{children}</body>
    </html>
  );
}
