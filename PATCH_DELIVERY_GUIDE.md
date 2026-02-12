# 📦 Patch Delivery Guide — Repo-Based Editing with Downloadable Output

> **Purpose:** When working with an uploaded `.zip` repo in an online model environment, this guide ensures all edits are captured as patch files in a downloadable folder — avoiding inline chat timeouts and lost output.
>
> **How to use:** Upload the repo `.zip` to the model's project folder alongside this guide. Point the model to target files. Tell it: _"Follow the Patch Delivery Guide."_

---

## 1 — Setup & Intake

| Step | Action |
|------|--------|
| **1.1** | Receive the uploaded `.zip` repo file. |
| **1.2** | Unzip to a working directory (e.g., `/repo`). |
| **1.3** | Create the **patch output folder**: `/patches` (this will become the downloadable artifact). |
| **1.4** | Create a **manifest file**: `/patches/MANIFEST.md` — this tracks every patch. |
| **1.5** | Read any additional pointed files, context docs, or prompts the user provides. |
| **1.6** | Confirm: _"Repo unzipped. Patch folder created. Ready to begin."_ |

---

## 2 — Context & Planning Phase

### 2.1 — Deep Context Scan
- Read and understand the **project structure** from the unzipped repo.
- Study any files the user specifically points to.
- Identify the **tech stack**, patterns, conventions, and architecture.

### 2.2 — Create the Plan
Before any edits, produce an **implementation plan** and write it to:

```
/patches/IMPLEMENTATION_PLAN.md
```

The plan must include:
- **Goal** — what the user wants achieved
- **Affected Files** — list of files that will be modified, created, or deleted
- **Approach** — how each change achieves the goal
- **Order of Operations** — dependencies between changes
- **Design Decisions** — any choices made and why

> ⚠️ **Present the plan summary in chat for user approval before proceeding to edits.**

---

## 3 — Editing & Patch Collection

### 3.1 — The Golden Rule

> **NEVER output full file contents inline in chat.**
> All code goes into the `/patches` folder. Chat only gets summaries.

### 3.2 — How to Patch

For **every file you modify or create**, do the following:

1. **Edit the file** in the working repo directory (`/repo/...`).
2. **Copy the edited file** into `/patches`, preserving the original directory structure:
   ```
   /patches/client/src/pages/TradePage.tsx       ← mirrors repo path
   /patches/server/routes/tradeRoutes.ts         ← mirrors repo path
   /patches/shared/types/trade.ts                ← mirrors repo path
   ```
3. **Log the patch** in `/patches/MANIFEST.md` (see Section 4).

### 3.3 — File Operations

| Operation | Action |
|-----------|--------|
| **MODIFY** | Edit the file in `/repo`, copy the full modified file to `/patches` at its mirrored path. |
| **NEW** | Create the new file directly in both `/repo` and `/patches` at the correct path. |
| **DELETE** | Add an entry to `/patches/DELETIONS.md` listing the file path and reason. Do NOT copy deleted files to patches. |
| **RENAME** | Log in `/patches/RENAMES.md` with `old_path → new_path`. Copy the file at its new path to `/patches`. |

### 3.4 — Continuous Collection
- Patch the folder **as you go**, not at the end.
- Every edit = immediate copy to `/patches`.
- This protects against session timeouts — partial work is always saved.

---

## 4 — Manifest File

Maintain `/patches/MANIFEST.md` with every patch logged. Format:

```markdown
# Patch Manifest

| # | Operation | File Path | Summary |
|---|-----------|-----------|---------|
| 1 | MODIFY | client/src/pages/TradePage.tsx | Added responsive grid layout |
| 2 | NEW | client/src/components/PriceChart.tsx | New chart component |
| 3 | MODIFY | server/routes/tradeRoutes.ts | Added validation middleware |
| 4 | DELETE | client/src/old/LegacyChart.tsx | Replaced by PriceChart |
```

---

## 5 — Chat Output Rules

### What Goes in Chat ✅
- Implementation plan summary
- Per-patch one-liner summaries (what was changed and why)
- Progress updates: _"Completed 5/12 patches."_
- Design decisions or trade-offs worth discussing
- Final delivery message with download link

### What Does NOT Go in Chat ❌
- Full file contents
- Large code blocks (>30 lines)
- Entire diffs

### Acceptable Chat Code
- **Short snippets** (≤15 lines) to explain a specific pattern or approach
- **Type signatures** or **interface definitions** for clarity
- **Before/after** of a single function (if brief)

---

## 6 — Quality Standards for Patches

Every patched file must:

- [ ] Be a **complete, drop-in replacement** — not a partial diff or fragment
- [ ] **Compile/parse** correctly on its own (no syntax errors)
- [ ] **Preserve existing imports** unless deliberately changed
- [ ] **Follow the repo's conventions** (naming, formatting, patterns)
- [ ] Include **no placeholder or TODO content** unless explicitly discussed
- [ ] Maintain **backwards compatibility** unless the user approves breaking changes

---

## 7 — Final Delivery

### 7.1 — Pre-Delivery Checklist
```
□ All edits are copied to /patches with correct paths
□ MANIFEST.md is complete and accurate
□ IMPLEMENTATION_PLAN.md reflects what was actually done
□ DELETIONS.md exists (if any files were deleted)
□ RENAMES.md exists (if any files were renamed)
□ No orphaned imports or broken references between patched files
```

### 7.2 — Package for Download
- Zip the entire `/patches` folder.
- Name it: `patches_[brief-description].zip`
- Make it available for download.

### 7.3 — Chat Delivery Message

```
## ✅ Patch Delivery Complete

**Total Patches:** [N] files
**Operations:** [X] modified, [Y] new, [Z] deleted
**Download:** [link to patches zip]

### Summary of Changes
1. [One-line summary per patch — keep brief]
2. ...

### How to Apply
1. Unzip the patches folder
2. Copy all files into your repo, overwriting existing files
3. Check DELETIONS.md for any files to manually remove
4. Check RENAMES.md for any files to manually rename
5. Run your build/lint to verify
```

---

## 8 — Edge Cases

### 8.1 — Session Running Long
If you sense the session may time out:
- **Immediately zip and deliver** whatever patches exist so far.
- Note in chat: _"Partial delivery — [N] of [M] patches complete. Remaining: [list]."_
- The user can continue in a follow-up session.

### 8.2 — Large Refactors (50+ files)
- Break into **batches** of 10–15 files.
- Deliver a zip per batch if needed.
- Number batches: `patches_batch_1.zip`, `patches_batch_2.zip`, etc.

### 8.3 — Conflicting Changes
If a later edit contradicts an earlier patch:
- **Update the patch file** in `/patches` (always keep only the latest version).
- Update the MANIFEST entry.
- Note in chat: _"Updated patch for [file] — supersedes earlier version."_

---

## 9 — Trigger Phrases

| Phrase | Action |
|--------|--------|
| _"Follow the Patch Delivery Guide"_ | Full workflow per this guide |
| _"Patch mode"_ | Same as above |
| _"Deliver patches"_ | Zip and output whatever is in `/patches` now |
| _"Show manifest"_ | Print the current MANIFEST.md in chat |
| _"Batch deliver"_ | Zip current batch and continue to next |

---

> **File Location:** `TD.2.ANTIGRAVITY/PATCH_DELIVERY_GUIDE.md`
> **Last Updated:** 2026-02-09
