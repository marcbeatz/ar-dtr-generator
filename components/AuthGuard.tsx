import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";

export async function AuthGuard({ children }: { children: React.ReactNode }) {
  if (!(await isAuthenticated())) redirect("/login");
  return children;
}
