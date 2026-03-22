export type BotGuardAction = "LOGIN" | "SIGNUP" | "TRADE";

export type BotWindows = {
  ip1m: number | null;
  ip10m: number | null;
  inst10m: number | null;
  fp10m: number | null;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function uaHeuristicsScore(ua: string): number {
  const s = ua.toLowerCase();
  let pts = 0;
  if (!ua) pts += 10;
  if (s.includes("headless")) pts += 25;
  if (s.includes("phantomjs")) pts += 40;
  if (s.includes("selenium")) pts += 40;
  if (s.includes("playwright")) pts += 35;
  if (s.includes("puppeteer")) pts += 35;
  if (s.includes("curl/")) pts += 40;
  if (s.includes("python-requests")) pts += 40;
  return pts;
}

export function labelFor(score: number) {
  if (score >= 60) return "HIGH";
  if (score >= 40) return "SUSPICIOUS";
  return "OK";
}

export function windowPenalty(action: BotGuardAction, w: BotWindows): number {
  const ip1m = w.ip1m ?? 0;
  const ip10m = w.ip10m ?? 0;
  const inst10m = w.inst10m ?? 0;
  const fp10m = w.fp10m ?? 0;

  let pts = 0;

  if (action === "SIGNUP") {
    if (ip1m >= 20) pts += 35;
    else if (ip1m >= 10) pts += 25;
    else if (ip1m >= 5) pts += 15;
    else if (ip1m >= 3) pts += 10;

    if (ip10m >= 80) pts += 25;
    else if (ip10m >= 40) pts += 15;
    else if (ip10m >= 20) pts += 10;

    if (inst10m >= 10) pts += 25;
    else if (inst10m >= 5) pts += 15;

    if (fp10m >= 20) pts += 15;
    else if (fp10m >= 10) pts += 10;
  } else if (action === "LOGIN") {
    if (ip1m >= 30) pts += 25;
    else if (ip1m >= 15) pts += 15;
    else if (ip1m >= 8) pts += 10;

    if (ip10m >= 200) pts += 25;
    else if (ip10m >= 100) pts += 15;
    else if (ip10m >= 50) pts += 10;

    if (inst10m >= 20) pts += 20;
    else if (inst10m >= 10) pts += 15;
    else if (inst10m >= 5) pts += 10;

    if (fp10m >= 40) pts += 15;
    else if (fp10m >= 20) pts += 10;
  } else {
    if (ip1m >= 60) pts += 25;
    else if (ip1m >= 30) pts += 15;

    if (ip10m >= 400) pts += 25;
    else if (ip10m >= 200) pts += 15;
    else if (ip10m >= 100) pts += 10;

    if (inst10m >= 40) pts += 20;
    else if (inst10m >= 20) pts += 15;
    else if (inst10m >= 10) pts += 10;

    if (fp10m >= 60) pts += 15;
    else if (fp10m >= 30) pts += 10;
  }

  return clamp(pts, 0, 60);
}
