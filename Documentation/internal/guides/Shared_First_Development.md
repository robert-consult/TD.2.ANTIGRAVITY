---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - .agents/shared-services.md
  - shared/
  - server/
  - client/
  - NATIVE/
last_verified: 2026-03-29
status: maintained
---

# Shared-First Development

## Rule

Before adding a new transport helper, identity primitive, locale helper, WS message type, or validation rule, scan `shared/` first.

## Typical Shared-First Domains

- HTTP and CSRF contracts
- WS message constants and client/server message semantics
- identity and device headers
- locale and timezone preferences
- E2EE envelope limits and parsing
- durable domain validation types reused by web, server, and native code

## Workflow

1. check whether `shared/` already owns the concept
2. extend `shared/` if the concept is cross-surface and durable
3. update server and all client consumers in the same change
4. avoid per-surface drift in regexes, enums, header names, and protocol strings

## Do Not Do

- do not duplicate WS message names in client-only constants
- do not reimplement request-identity parsing in multiple runtimes
- do not add surface-specific variants of a durable contract unless the divergence is intentional and documented
