import { PasswordGate } from "@/components/PasswordGate";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const nextPath = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
  return <PasswordGate nextPath={nextPath} />;
}
