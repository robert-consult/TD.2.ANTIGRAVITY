import { storage } from "../server/storage";
import { bootstrapDoc2Seed } from "../server/legal/bootstrapDoc2Seed";

function usage(): string {
  return [
    "Usage:",
    "  npm run legal:seed:doc2",
    "  npm run legal:seed:doc2 -- <adminUserId>",
    "  npm run legal:seed:doc2 -- --admin-user-id <adminUserId>",
    "  npm run legal:seed:doc2 -- --admin-email <email>",
    "",
    "Defaults:",
    "  --admin-email admin@local.test",
  ].join("\n");
}

function parseArgs(argv: string[]): { adminUserId?: number; adminEmail?: string; help?: boolean } {
  let adminUserId: number | undefined;
  let adminEmail: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { help: true };

    if (arg === "--admin-user-id" || arg === "--adminUserId") {
      const raw = argv[++i];
      const parsed = Number(raw);
      if (!raw || !Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid --admin-user-id: ${raw ?? ""}`);
      }
      adminUserId = parsed;
      continue;
    }

    if (arg === "--admin-email" || arg === "--adminEmail") {
      const raw = argv[++i];
      if (!raw) throw new Error("Missing value for --admin-email");
      adminEmail = raw;
      continue;
    }

    if (!arg.startsWith("-") && adminUserId === undefined) {
      const parsed = Number(arg);
      if (Number.isInteger(parsed) && parsed > 0) {
        adminUserId = parsed;
        continue;
      }
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { adminUserId, adminEmail };
}

async function main() {
  try {
    const { adminUserId, adminEmail, help } = parseArgs(process.argv.slice(2));
    if (help) {
      console.log(usage());
      return;
    }

    let resolvedAdminUserId = adminUserId;
    if (resolvedAdminUserId === undefined) {
      const email = adminEmail ?? "admin@local.test";
      const user = await storage.getUserByEmail(email);
      if (!user) {
        throw new Error(
          `Admin user not found for email ${email}. Run \`npm run db:seed\` or pass --admin-user-id.`,
        );
      }
      if (!user.isAdmin) {
        throw new Error(`User ${email} exists but is not an admin (id=${user.id}).`);
      }
      resolvedAdminUserId = user.id;
    }

    await bootstrapDoc2Seed(resolvedAdminUserId);
  } catch (err) {
    console.error(err);
    console.error("");
    console.error(usage());
    process.exitCode = 1;
  }
}

void main();

