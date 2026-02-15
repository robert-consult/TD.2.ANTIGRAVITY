import QRCode from "qrcode";

type Rgb = [number, number, number];

export type CertificatePdfRenderInput = {
  certificateId: number;
  challengeName: string;
  templateName: string;
  headerText: string;
  bodyText: string;
  issuedIso: string;
  brandColor: string | null;
  logoUrl: string | null;
  includeMetrics: boolean;
  includeVerificationCode: boolean;
  includeQr: boolean;
  verificationCode: string;
  verificationUrl: string;
  metrics: Record<string, unknown>;
};

const PAGE_W = 612;
const PAGE_H = 792;

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function parseHexColor(input: string | null): Rgb {
  const raw = String(input ?? "").trim();
  const m = /^#?([0-9a-fA-F]{6})$/.exec(raw);
  if (!m) return [0.07, 0.19, 0.35];
  const hex = m[1];
  const r = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const g = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const b = Number.parseInt(hex.slice(4, 6), 16) / 255;
  return [clamp01(r), clamp01(g), clamp01(b)];
}

function lighten(color: Rgb, pct: number): Rgb {
  const p = clamp01(pct);
  return [
    clamp01(color[0] + (1 - color[0]) * p),
    clamp01(color[1] + (1 - color[1]) * p),
    clamp01(color[2] + (1 - color[2]) * p),
  ];
}

function toPdfYTop(top: number, height = 0): number {
  return PAGE_H - top - height;
}

function normalizeLine(value: unknown, maxLen = 220): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

function wrapText(value: string, maxChars = 86): string[] {
  const text = normalizeLine(value, 4000);
  if (!text) return [];
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!word) continue;
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 24);
}

function metricLine(metrics: Record<string, unknown>): string {
  return [
    `PnL% ${String(metrics.pnlPct ?? "-")}`,
    `Trading Days ${String(metrics.tradingDays ?? "-")}`,
    `Max DD ${String(metrics.maxTotalLossHit ?? "-")}`,
  ].join("  |  ");
}

function drawQrCommands(url: string, x: number, yTop: number, width: number): string[] {
  let qr: any;
  try {
    qr = (QRCode as any).create(String(url || ""), { errorCorrectionLevel: "M" });
  } catch {
    return [];
  }

  const modules = qr?.modules;
  const size = Number(modules?.size ?? 0);
  const data: unknown[] = Array.isArray(modules?.data) ? modules.data : [];
  if (!Number.isInteger(size) || size <= 0 || data.length < size * size) return [];

  const module = width / size;
  const commands: string[] = [];
  commands.push("q");
  commands.push("1 1 1 rg");
  commands.push(`${x} ${toPdfYTop(yTop, width)} ${width} ${width} re f`);
  commands.push("0 0 0 rg");

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (!data[row * size + col]) continue;
      const mx = x + col * module;
      const myTop = yTop + row * module;
      commands.push(`${mx.toFixed(3)} ${toPdfYTop(myTop, module).toFixed(3)} ${module.toFixed(3)} ${module.toFixed(3)} re f`);
    }
  }
  commands.push("Q");
  return commands;
}

export function renderChallengeCertificatePdf(input: CertificatePdfRenderInput): Buffer {
  const brand = parseHexColor(input.brandColor);
  const brandSoft = lighten(brand, 0.66);

  const lines: string[] = [];

  lines.push("q");
  lines.push("0.98 0.98 0.99 rg");
  lines.push(`0 0 ${PAGE_W} ${PAGE_H} re f`);
  lines.push("Q");

  lines.push("q");
  lines.push(`${brand[0].toFixed(3)} ${brand[1].toFixed(3)} ${brand[2].toFixed(3)} rg`);
  lines.push(`0 ${toPdfYTop(0, 102)} ${PAGE_W} 102 re f`);
  lines.push("Q");

  lines.push("q");
  lines.push(`${brandSoft[0].toFixed(3)} ${brandSoft[1].toFixed(3)} ${brandSoft[2].toFixed(3)} rg`);
  for (let y = 120; y < 760; y += 26) {
    for (let x = 26; x < PAGE_W - 26; x += 28) {
      lines.push(`${x} ${toPdfYTop(y, 1)} 1 1 re f`);
    }
  }
  lines.push("Q");

  lines.push("q");
  lines.push("0.84 0.88 0.93 RG");
  lines.push("1.2 w");
  lines.push(`34 ${toPdfYTop(116, 642)} 544 642 re S`);
  lines.push("Q");

  const title = normalizeLine(input.headerText || "Completion Certificate", 160);
  const challengeName = normalizeLine(input.challengeName || "Challenge", 160);
  const bodyLines = wrapText(input.bodyText || "", 88);
  const issuedAt = normalizeLine(input.issuedIso, 64);
  const templateName = normalizeLine(input.templateName || "Default", 80);
  const verificationCode = normalizeLine(input.verificationCode, 120);
  const verificationUrl = normalizeLine(input.verificationUrl, 240);
  const logoUrl = normalizeLine(input.logoUrl, 200);
  const watermark = "TRADEQUIP CERTIFIED";

  lines.push("BT");
  lines.push("/F2 36 Tf");
  lines.push("0.17 0.17 0.19 rg");
  lines.push(`112 ${toPdfYTop(374, 36)} Td (${escapePdfText(watermark)}) Tj`);
  lines.push("ET");

  lines.push("BT");
  lines.push("/F2 28 Tf");
  lines.push("1 1 1 rg");
  lines.push(`44 ${toPdfYTop(34, 28)} Td (${escapePdfText("TradeQuip")}) Tj`);
  lines.push("ET");

  lines.push("BT");
  lines.push("/F1 11 Tf");
  lines.push("0.95 0.95 0.97 rg");
  lines.push(`44 ${toPdfYTop(70, 11)} Td (${escapePdfText("Challenge Certificate")}) Tj`);
  lines.push("ET");

  if (logoUrl) {
    lines.push("BT");
    lines.push("/F1 8 Tf");
    lines.push("0.95 0.95 0.97 rg");
    lines.push(`350 ${toPdfYTop(72, 8)} Td (${escapePdfText(`Logo: ${logoUrl}`)}) Tj`);
    lines.push("ET");
  }

  lines.push("BT");
  lines.push("/F2 24 Tf");
  lines.push("0.10 0.11 0.15 rg");
  lines.push(`56 ${toPdfYTop(156, 24)} Td (${escapePdfText(title)}) Tj`);
  lines.push("ET");

  lines.push("BT");
  lines.push("/F2 18 Tf");
  lines.push("0.10 0.11 0.15 rg");
  lines.push(`56 ${toPdfYTop(192, 18)} Td (${escapePdfText(challengeName)}) Tj`);
  lines.push("ET");

  lines.push("BT");
  lines.push("/F1 11 Tf");
  lines.push("0.12 0.14 0.18 rg");
  lines.push(`56 ${toPdfYTop(224, 11)} Td (${escapePdfText(`Certificate ID: ${input.certificateId}`)}) Tj`);
  lines.push(`0 -15 Td (${escapePdfText(`Issued: ${issuedAt}`)}) Tj`);
  lines.push(`0 -15 Td (${escapePdfText(`Template: ${templateName}`)}) Tj`);
  lines.push("ET");

  let bodyY = 282;
  if (bodyLines.length) {
    lines.push("BT");
    lines.push("/F1 11 Tf");
    lines.push("0.14 0.14 0.17 rg");
    lines.push(`56 ${toPdfYTop(bodyY, 11)} Td`);
    for (let i = 0; i < bodyLines.length; i += 1) {
      if (i > 0) lines.push("0 -15 Td");
      lines.push(`(${escapePdfText(bodyLines[i])}) Tj`);
    }
    lines.push("ET");
    bodyY += bodyLines.length * 15 + 18;
  }

  if (input.includeMetrics) {
    lines.push("BT");
    lines.push("/F1 10 Tf");
    lines.push("0.08 0.11 0.18 rg");
    lines.push(`56 ${toPdfYTop(bodyY, 10)} Td (${escapePdfText(metricLine(input.metrics))}) Tj`);
    lines.push("ET");
    bodyY += 22;
  }

  if (input.includeVerificationCode && verificationCode) {
    lines.push("BT");
    lines.push("/F2 12 Tf");
    lines.push("0.08 0.11 0.18 rg");
    lines.push(`56 ${toPdfYTop(bodyY, 12)} Td (${escapePdfText(`Verification Code: ${verificationCode}`)}) Tj`);
    lines.push("ET");
    bodyY += 20;
  }

  if (verificationUrl) {
    lines.push("BT");
    lines.push("/F1 8 Tf");
    lines.push("0.20 0.22 0.28 rg");
    lines.push(`56 ${toPdfYTop(bodyY, 8)} Td (${escapePdfText(verificationUrl)}) Tj`);
    lines.push("ET");
  }

  if (input.includeQr && verificationUrl) {
    lines.push(...drawQrCommands(verificationUrl, 454, 534, 108));
  }

  lines.push("q");
  lines.push("0.65 0.67 0.71 RG");
  lines.push("1 w");
  lines.push(`56 ${toPdfYTop(682, 1)} m 286 ${toPdfYTop(682, 1)} l S`);
  lines.push("Q");

  lines.push("BT");
  lines.push("/F1 10 Tf");
  lines.push("0.24 0.26 0.32 rg");
  lines.push(`56 ${toPdfYTop(700, 10)} Td (${escapePdfText("Authorized Signature")}) Tj`);
  lines.push(`0 -14 Td (${escapePdfText("TradeQuip Compliance Desk")}) Tj`);
  lines.push("ET");

  const contentStream = lines.join("\n");
  const objects = [
    "",
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    `<< /Length ${Buffer.byteLength(contentStream, "utf8")} >>\nstream\n${contentStream}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = Buffer.byteLength(pdf, "utf8");
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

