import {
  DOC_LAST_VERIFIED,
  parseSimpleTableRow,
  readText,
  renderFrontMatter,
  repoPath,
  writeFileIfChanged,
} from "../../lib/shared";

type MessageRecord = {
  constantName: string;
  messageType: string;
  direction: string;
  source: string;
};

const OUTPUT_PATH = repoPath("Documentation", "generated", "WebSocket_Catalog.md");
const GENERATOR_SOURCE = "scripts/docs/generators/ws/index.ts";

function inferDirection(constantName: string): string {
  if (constantName.includes("SUBSCRIBE") || constantName.includes("UNSUBSCRIBE")) return "client -> server";
  if (constantName === "WS_MSG_AUTH_HELLO") return "client -> server";
  if (constantName === "WS_MSG_PING") return "client -> server";
  if (constantName === "WS_MSG_PONG") return "server -> client";
  return "server -> client";
}

export async function buildWsCatalog(): Promise<string> {
  const protocolFile = repoPath("shared", "ws", "protocol.ts");
  const protocolText = await readText(protocolFile);
  const constantRegex = /^export const (WS_MSG_[A-Z0-9_]+)\s*=\s*"([^"]+)";$/gm;
  const records: MessageRecord[] = [];

  for (const match of protocolText.matchAll(constantRegex)) {
    const constantName = match[1] ?? "";
    const messageType = match[2] ?? "";
    if (!constantName || !messageType) continue;
    records.push({
      constantName,
      messageType,
      direction: inferDirection(constantName),
      source: "shared/ws/protocol.ts",
    });
  }

  const protocolVersionMatch = protocolText.match(/export const WS_PROTOCOL_VERSION = (\d+);/);
  const protocolVersion = protocolVersionMatch?.[1] ?? "unknown";

  const rows = records
    .sort((left, right) => left.messageType.localeCompare(right.messageType))
    .map((record) =>
      parseSimpleTableRow([
        `\`${record.messageType}\``,
        record.direction,
        `\`${record.constantName}\``,
        `\`${record.source}\``,
      ]),
    );

  return [
    renderFrontMatter({
      audience: "generated",
      exposure: "internal",
      owner: "documentation-program",
      canonicalSources: ["shared/ws/protocol.ts", "server/routes/wsCore.ts", "client/src/live/"],
      lastVerified: DOC_LAST_VERIFIED,
      status: "generated",
      generatedFrom: [GENERATOR_SOURCE],
    }),
    "# WebSocket Catalog",
    "",
    "> Generated from the canonical protocol module and the current WS runtime integration points.",
    "",
    `Protocol version: **${protocolVersion}**`,
    "",
    "## Canonical Message Types",
    "",
    "| Type | Direction | Constant | Source |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    "## Runtime Integration Points",
    "",
    "| Area | File | Notes |",
    "| --- | --- | --- |",
    "| Server runtime | `server/routes/wsCore.ts` | Upgrade handling, auth handshake, fanout, metrics, rate limits |",
    "| Shared protocol | `shared/ws/protocol.ts` | Endpoint path, protocol version, message constants |",
    "| Client live updates | `client/src/live/LiveUpdatesProvider.tsx` | Socket bootstrap and auth hello |",
    "| Quote sync | `client/src/live/QuotesProvider.tsx` | Quote subscribe, unsubscribe, snapshot, update handling |",
    "| Config sync | `client/src/live/ConfigSync.tsx` | Global settings, legal doc, and quote-subscription invalidation |",
    "",
  ].join("\n");
}

export async function generateWsCatalog(): Promise<void> {
  const content = await buildWsCatalog();
  await writeFileIfChanged(OUTPUT_PATH, content);
}
