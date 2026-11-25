export const GATE_COOKIE = "ar_dtr_auth";
export const GATE_MAX_AGE = 60 * 60 * 24;

export function expectedPassword() {
  return process.env.SITE_PASSWORD ?? "";
}

export function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

export function passwordMatches(cookieValue: string | undefined) {
  if (cookieValue === undefined) return false;
  return safeEqual(cookieValue, expectedPassword());
}
