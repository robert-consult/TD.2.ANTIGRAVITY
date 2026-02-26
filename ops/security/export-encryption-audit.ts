/**
 * Export Encryption Audit
 *
 * Verifies that objectStorage.ts passes server-side encryption (SSE)
 * headers to MinIO when uploading export artifacts, ensuring data-at-rest
 * encryption for all CSV/JSONL files.
 *
 * Usage: npx tsx ops/security/export-encryption-audit.ts
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const OBJ_STORAGE_PATH = path.resolve(currentDir, "../../server/services/objectStorage.ts");

function audit() {
    if (!fs.existsSync(OBJ_STORAGE_PATH)) {
        console.error(`[FAIL] objectStorage.ts not found at ${OBJ_STORAGE_PATH}`);
        process.exit(1);
    }

    const src = fs.readFileSync(OBJ_STORAGE_PATH, "utf-8");

    const requiredChecks = [
        { name: "SSE Header (x-amz-server-side-encryption)", pattern: /x-amz-server-side-encryption|ServerSideEncryption/i },
    ];
    const optionalChecks = [
        { name: "SSE-KMS Key ID", pattern: /x-amz-server-side-encryption-aws-kms-key-id|SSEKMSKeyId/i },
        { name: "Multipart SSE propagation", pattern: /CreateMultipartUpload.*ServerSideEncryption|SSE.*multipart/is },
    ];

    let pass = 0, fail = 0;

    for (const { name, pattern } of requiredChecks) {
        if (pattern.test(src)) {
            console.log(`[PASS] ${name} — found in objectStorage.ts`);
            pass++;
        } else {
            console.warn(`[FAIL] ${name} — NOT found. Export artifacts may be stored unencrypted.`);
            fail++;
        }
    }

    let optionalWarn = 0;
    for (const { name, pattern } of optionalChecks) {
        if (pattern.test(src)) {
            console.log(`[PASS] ${name} — found in objectStorage.ts`);
        } else {
            console.warn(`[WARN] ${name} — NOT found. Using SSE-S3/AES256 without explicit KMS/multipart settings.`);
            optionalWarn++;
        }
    }

    console.log(`\nAudit complete: ${pass} required pass, ${fail} required fail, ${optionalWarn} optional warnings.`);

    if (fail > 0) {
        console.log("\nRecommendation: ensure upload path sets x-amz-server-side-encryption (AES256 or aws:kms).");
        process.exit(1);
    }
}

audit();
