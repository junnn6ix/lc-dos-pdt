import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "LC-DOS Distributed Cluster Dashboard",
  description: "Letter Coffee Distributed Ordering System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" className={`${dmSans.variable} font-sans`}>
      <body className="bg-[#020617] text-slate-100 min-h-screen">
        {children}
      </body>
    </html>
  );
}
