import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { GATE_COOKIE, passwordMatches } from "@/lib/gate";

function homeUrl(request: NextRequest) {
  const home = request.nextUrl.clone();
  home.pathname = "/";
  home.search = "";
  return home;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const open = passwordMatches(request.cookies.get(GATE_COOKIE)?.value);

  if (open) {
    if (pathname === "/login") return NextResponse.redirect(homeUrl(request));
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (pathname === "/login") return NextResponse.next();

  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  if (pathname !== "/") login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
