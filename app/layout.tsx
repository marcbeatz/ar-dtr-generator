import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "AR and DTR Generator",
  description: "Fill a Daily Time Record or an accomplishment report.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="top">
            <Link className="brand" href="/">AR / DTR</Link>
            <span>Files stay on this computer</span>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
