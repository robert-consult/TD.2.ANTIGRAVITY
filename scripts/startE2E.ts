import { spawn } from "node:child_process";

const child = spawn("node", ["dist/index.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "production",
    COOKIE_SECURE: "false",
    FORGE_KEY: "",
    QUOTE_SOURCE: "simulated",
    LEGAL_TERMS_HMAC_SECRET: "dummy_dummy_dummy_dummy_dummy_dummy_dummy_dummy",
    SESSION_SECRET: "dummy_dummy_dummy_dummy_dummy_dummy_dummy_dummy",
    EMAIL_VERIFY_TOKEN_SECRET: "dummy_dummy_dummy_dummy_dummy_dummy_dummy_dummy",
    ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    RESEND_API_KEY: "dummy",
    RESEND_FROM: "dummy",
    TWILIO_ACCOUNT_SID: "dummy",
    TWILIO_AUTH_TOKEN: "dummy",
    TWILIO_FROM_NUMBER: "+10000000000",
  },
});

child.once("error", (error) => {
  console.error("[start:e2e] failed to start dist server", error);
  process.exit(1);
});

child.once("exit", (code, signal) => {
  if (typeof code === "number") {
    process.exit(code);
    return;
  }
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(0);
});
