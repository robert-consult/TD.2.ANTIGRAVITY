# `gitops/` AGENTS.md

## Purpose

This folder contains GitOps application definitions and Kustomize overlays used by Argo CD.

## Rules

- Treat git as the source of truth for deployment state.
- Do not hardcode live secrets here; use SOPS-encrypted manifests or placeholder templates that are encrypted before sync.
- Update overlay image references through `scripts/ops/updateKustomizeImage.ts` or the promotion workflow rather than editing deployment images directly.
- Keep Argo CD app paths and overlay paths aligned in the same change.
