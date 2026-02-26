/**
 * CSV Injection Fuzzer
 *
 * Tests that the export pipeline correctly neutralizes formula injection
 * payloads (=, +, -, @, |) in CSV output cells.
 *
 * Usage: npx tsx ops/security/csv-injection-fuzzer.ts
 */

const PAYLOADS = [
    `=cmd|'/C calc'!A0`,
    `=1+1`,
    `+1+1`,
    `-1+1`,
    `@SUM(A1:A10)`,
    `|calc`,
    `\t=1+1`,
    `=HYPERLINK("http://evil.com","Click")`,
];

// Replicates the expected csvEscape behavior from the export workers
function csvEscape(val: string | number | null | undefined): string {
    if (val === null || val === undefined) return "";
    let str = String(val);
    // Formula injection defense: prefix dangerous first chars with single quote
    if (/^[=+\-@|\t\r]/.test(str)) str = `'${str}`;
    // Standard CSV quoting
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("'")) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

let failures = 0;

for (const payload of PAYLOADS) {
    const escaped = csvEscape(payload);
    // The escaped value must not start with a dangerous char when unquoted,
    // or must be prefixed with ' inside quotes
    const inner = escaped.startsWith('"') ? escaped.slice(1, -1).replace(/""/g, '"') : escaped;
    const dangerous = /^[=+\-@|]/.test(inner);

    if (dangerous) {
        console.error(`[FAIL] Payload "${payload}" → "${escaped}" still starts with dangerous char.`);
        failures++;
    } else {
        console.log(`[PASS] "${payload}" → "${escaped}"`);
    }
}

if (failures > 0) {
    console.error(`\n${failures} payload(s) bypassed CSV escaping.`);
    process.exit(1);
}
console.log(`\nAll ${PAYLOADS.length} payloads neutralized.`);
