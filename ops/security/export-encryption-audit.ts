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

const OBJ_STORAGE_PATH = path.resolve(__dirname, "../../server/services/objectStorage.ts");

function audit() {
    if (!fs.existsSync(OBJ_STORAGE_PATH)) {
        console.error(`[FAIL] objectStorage.ts not found at ${OBJ_STORAGE_PATH}`);
        process.exit(1);
    }

    const src = fs.readFileSync(OBJ_STORAGE_PATH, "utf-8");

    const checks = [
        { name: "SSE Header (x-amz-server-side-encryption)", pattern: /x-amz-server-side-encryption|ServerSideEncryption/i },
        { name: "SSE-KMS Key ID", pattern: /x-amz-server-side-encryption-aws-kms-key-id|SSEKMSKeyId/i },
        { name: "Multipart SSE propagation", pattern: /CreateMultipartUpload.*ServerSideEncryption|SSE.*multipart/is },
    ];

    let pass = 0, fail = 0;

    for (const { name, pattern } of checks) {
        if (pattern.test(src)) {
            console.log(`[PASS] ${name} — found in objectStorage.ts`);
            pass++;
        } else {
            console.warn(`[WARN] ${name} — NOT found. Export artifacts may be stored unencrypted.`);
            fail++;
        }
    }

    console.log(`\nAudit complete: ${pass} pass, ${fail} warnings.`);

    if (fail > 0) {
        console.log("\nRecommendation: Add SSE-KMS headers to PutObjectCommand and CreateMultipartUploadCommand:");
        console.log(`  ServerSideEncryption: "aws:kms",`);
        console.log(`  SSEKMSKeyId: process.env.MINIO_KMS_KEY_ID || "tradehub-export-key"`);
        process.exit(1);
    }
}

audit();
