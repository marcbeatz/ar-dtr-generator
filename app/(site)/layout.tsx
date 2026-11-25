import Link from "next/link";
import { AuthGuard } from "@/components/AuthGuard";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="shell">
        <header className="top">
          <Link className="brand" href="/">AR / DTR</Link>
          <span>Files stay on this computer</span>
        </header>
        {children}
      </div>
    </AuthGuard>
  );
}
