import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { Providers } from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pullarao AppForge — Build apps with Pullarao 1",
  description: "Multi-user platform that generates Android & web apps with Pullarao 1, pushes to your GitHub, and deploys to your hosting.",
  keywords: ["Pullarao 1", "AI app builder", "Next.js", "Android", "GitHub Actions", "deploy"],
  authors: [{ name: "Pullarao AppForge" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <Providers>
          {children}
          <SonnerToaster position="top-right" richColors />
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
