"use server";

import { cookies } from "next/headers";
import { GATE_COOKIE, GATE_MAX_AGE, expectedPassword, passwordMatches, safeEqual } from "@/lib/gate";

export async function isAuthenticated() {
  const store = await cookies();
  return passwordMatches(store.get(GATE_COOKIE)?.value);
}

export async function unlockSite(password: string) {
  const expected = expectedPassword();
  if (!safeEqual(password, expected)) return false;
  const store = await cookies();
  store.set(GATE_COOKIE, password, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GATE_MAX_AGE,
  });
  return true;
}
