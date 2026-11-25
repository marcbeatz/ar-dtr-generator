import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AR and DTR Generator",
  description: "Fill a Daily Time Record or an accomplishment report.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
