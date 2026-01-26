# `attached_assets/` AGENTS.md (Design & Context Repository)

## What this area is
**Reference materials for deeper context provision**—NOT source code.

This folder contains uploaded files used for:
- **Design Ideation**: Mockups, wireframes, UI/UX explorations
- **Conversation Flows**: `.txt` and `.doc` files with past implementation discussions
- **Project Flows**: Implementation plans, architecture diagrams, code block references
- **Static Assets**: Images for debugging, testing, and visual reference
- **Code Block Inputs**: Text files with code snippets for agent ingestion

## Non-negotiables
- **No source code**: This is a reference folder, not part of the build.
- **No secrets or PII**: Do not upload credentials, API keys, or personal data.
- **No large binaries in git**: Prefer external storage for files > 10MB.

## Typical contents
| Type | Examples |
|------|----------|
| Design mockups | `.png`, `.jpg`, `.fig` exports |
| Conversation logs | `.txt` files with implementation discussions |
| Implementation flows | `.md`, `.doc` , `.txt`   with architecture decisions |
| Code block references | `.txt` with code snippets for context |
| Debugging assets | Screenshots, error logs, test fixtures |

## Agent behavior
- **DO scan this folder** for design context when working on UI/UX.
- **DO reference** `.txt`/`.doc` files for implementation history.
- **DO NOT treat** any file here as executable source code.

## Required checks before finalizing
- Ensure no secrets or PII are embedded in files or image metadata.
- Verify files are appropriately named for easy discovery.
- Consider cleaning up outdated assets periodically.
