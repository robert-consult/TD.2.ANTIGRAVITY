# 🔁 COT Output Extraction Guide — Masterlist

> **Purpose:** When a chain-of-thought session produced all the right reasoning and edits but the final output failed to render in chat, use this guide to recover the intended deliverable.
>
> **How to use:** Paste the `.txt` chain-of-thought logs into the model's chat window alongside this file. Tell the model: _"Extract the intended output per the COT Extraction Guide."_

---

## 1 — Intake & Triage

| Step | Action |
|------|--------|
| **1.1** | Receive the `.txt` chain-of-thought file(s) from the user. |
| **1.2** | Confirm: _"I have received [N] file(s). Beginning extraction."_ |
| **1.3** | Identify the **type** of intended output (code file, design doc, audit report, implementation plan, PRD, UI mockup description, etc.). |
| **1.4** | Identify the **target location** — where should the final output be saved or delivered? |

---

## 2 — Deep-Read the Chain of Thought

Read the entire COT log(s) sequentially. While reading, extract and note the following:

### 2.1 — Intent Markers
- What was the **original user request**? (usually near the top)
- What **goal** did the model converge on?
- Were there any **scope changes** or **pivots** mid-conversation?

### 2.2 — Final State of Work
- Identify the **last stable version** of any output the model was building (code, document, plan, etc.).
- Look for phrases like:
  - _"Here is the final..."_
  - _"The completed output is..."_
  - _"Writing to file..."_
  - _"Updated version:"_
  - Tool calls like `write_to_file`, `replace_file_content`, `multi_replace_file_content`
- If the model made **incremental edits**, reconstruct the final document by applying all edits in order.

### 2.3 — Unfinished Sections
- Flag any sections the model **started but did not complete**.
- Flag any sections the model **planned to write** but never reached.
- Note any `TODO`, `FIXME`, placeholder text, or `...` truncations.

### 2.4 — Reasoning & Decisions
- Note any **design decisions** with their rationale.
- Capture any **trade-offs** the model evaluated.

---

## 3 — Reconstruct the Intended Output

### 3.1 — Assembly Rules

1. **Start from the latest complete version** found in the COT.
2. **Apply all subsequent edits** in chronological order.
3. **If the output was never fully assembled** (e.g., the model was building it piece-by-piece and crashed), stitch the pieces together logically.
4. **Fill gaps** — if the model clearly intended to include a section but didn't write it:
   - Use the reasoning from the COT to infer what should go there.
   - Mark inferred sections with a `<!-- INFERRED -->` comment so the user knows.
5. **Do NOT hallucinate content** that has no basis in the COT. If you cannot reconstruct a section, mark it with `<!-- INCOMPLETE: [reason] -->`.

### 3.2 — Quality Checks

- [ ] Does the output match the **original user request**?
- [ ] Does the output reflect all **edits and refinements** from the COT?
- [ ] Are there any **contradictions** between early reasoning and the final output?
- [ ] Is the output **complete** — no missing sections, no trailing truncations?
- [ ] Is the **formatting** correct for the output type (markdown, code syntax, etc.)?

---

## 4 — Output Delivery

### 4.1 — Format the Output
- Match the **exact format** the model was targeting (`.md`, `.tsx`, `.ts`, `.css`, `.json`, etc.).
- Preserve any **file structure** the model was building (e.g., if it was creating multiple files, deliver all of them).

### 4.2 — Deliver with Summary
Present the output with a brief header:

```
## ✅ Extracted Output

**Source:** [filename(s) of the COT .txt files]
**Output Type:** [e.g., Implementation Plan, Audit Report, Code File]
**Completeness:** [Complete / Partial — N sections inferred / Incomplete — missing X]
**Notes:** [Any caveats or decisions made during reconstruction]
```

### 4.3 — Save to File
- If a target file path is identified in the COT, save the output there.
- If no target path is identified, ask the user where to save.
- Use `write_to_file` or equivalent to persist the output.

---

## 5 — Edge Cases

### 5.1 — Multiple Competing Versions
If the COT contains multiple versions of the same output (e.g., the model rewrote something several times):
- **Use the last version** unless the user specifies otherwise.
- Note: _"Multiple versions were found in the COT. Using the final iteration (version N)."_

### 5.2 — Ambiguous Intent
If the model's intent is unclear from the COT:
- **Do NOT guess.** Ask the user to clarify.
- Present the ambiguity: _"The COT shows two possible directions: [A] and [B]. Which should I pursue?"_

### 5.3 — Code with Dependencies
If the output is code that depends on other files:
- Check if those files exist in the project.
- If they don't, flag the dependencies: _"This output references [file] which does not exist. Should I create it?"_

### 5.4 — Massive Output (>500 lines)
If the reconstructed output is very large:
- Deliver it as a file write, not inline chat.
- Provide a summary/outline in chat with a link to the file.

---

## 6 — Quick-Reference Checklist

```
When the user says "Extract the intended output":

□ Read all provided .txt COT files
□ Identify the original request and intended output type
□ Find the latest/final version of the output in the COT
□ Apply all incremental edits chronologically
□ Fill gaps using COT reasoning (mark with <!-- INFERRED -->)
□ Flag anything that can't be reconstructed (<!-- INCOMPLETE -->)
□ Format to match the intended output type
□ Deliver with completeness summary
□ Save to the appropriate file location
```

---

## 7 — Trigger Phrases

The user may invoke this guide using any of the following:

| Phrase | Action |
|--------|--------|
| _"Extract the intended output"_ | Full extraction per this guide |
| _"Recover the COT output"_ | Same as above |
| _"What was the final output?"_ | Read COT → present the last stable output |
| _"Complete the failed output"_ | Extraction + fill gaps + complete unfinished work |
| _"Just give me what it built"_ | Quick extraction — skip research, deliver as-is |

---

> **File Location:** `TD.2.ANTIGRAVITY/COT_OUTPUT_EXTRACTION_GUIDE.md`
> **Last Updated:** 2026-02-09
