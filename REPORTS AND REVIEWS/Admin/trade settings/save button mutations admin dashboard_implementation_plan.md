# Implementation Plan: Admin Dashboard Save Buttons Decoupling

## Goal Description
The Admin Dashboard currently suffers from state coupling where a single boolean (e.g., `riskParamsChanged`, `configChanged`) activates the "Save" buttons for all cards within a tab simultaneously when any single setting is changed. Furthermore, saving the changes triggers a generic toast notification and submits all state variables instead of just the ones scoped to the card. 

The goal is to decouple these save buttons such that:
1. Only the "Save" button for the specific card where settings were changed becomes active.
2. Clicking "Save" submits only the relevant fields for that card (or successfully submits without affecting un-intended parallel edits).
3. A highly specific, context-aware toast notification is displayed upon successful save for that specific card.

## Proposed Changes

### client/src/pages/AdminDashboard.tsx

#### [MODIFY] AdminDashboard.tsx
- **State Decoupling**: 
  - Remove generic boolean flags like `riskParamsChanged`, `configChanged`, `marketPerfChanged`, and `i18nChanged`.
  - Introduce dynamic comparator functions (or inline checks) for each card to evaluate if its specific fields differ from the source of truth (`globalSettingsData`, `systemConfig`, etc.).
  - Example: `const isCapitalSettingsChanged = riskParams.defaultUserStartingBalanceUsd !== globalSettingsData?.defaultUserStartingBalanceUsd || ...;`
- **Mutation Restructuring**:
  - Remove generic `onSuccess` toast notifications from the `useMutation` definitions (e.g., `globalSettingsMutation`, `updateMutation`, `updateI18nMutation`).
  - Update each card's "Save" button `onClick` handler to pass a specific payload and inject a specific `onSuccess` callback via the `mutate()` options.
  - Example: `globalSettingsMutation.mutate({ defaultUserStartingBalanceUsd: ... }, { onSuccess: () => toast({ title: "Capital Settings Saved", description: "Default capital configurations updated successfully." }) })`.
- **Card Updates**:
  - **Trade Settings Tab**: Decouple Capital Settings, Market Hours, Default Risk Parameters, and FX Rollover.
  - **Platform Settings Tab (System Config)**: Decouple Trading Controls, System Limits, Feature Flags, and General System config.
  - **Performance Tab**: Decouple WebSocket Controls, Prefetch Strategy, and Network Base Tiers.
  - **Market Data Tab**: Decouple Providers, Instrument Ingestion.
  - **Legal / I18n**: Decouple I18n controls.
  - **User Management Tab**: Verify KYC Controls (`policyConfigChanged`) is isolated, and ensure specific toasts for user bulk actions, balance updates, and settings edits.

## Verification Plan

### Automated Tests
- The backend API endpoints already support `Partial<GlobalSettings>` and `Partial<SystemConfig>` logic, so no new backend unit tests are inherently required. Existing API tests should pass.

### Manual Verification
1. Open the Admin Dashboard.
2. Navigate to the **Trade Settings** tab.
3. Modify a value in "Default Capital Settings" (e.g., default balance). Verify that *only* the "Save" button for "Default Capital Settings" becomes active; the "Market Hours" and "Default Risk Parameters" Save buttons must remain disabled.
4. Click "Save" on "Default Capital Settings". Verify that the toast specifically says "Capital Settings Saved".
5. Change a field in "Market Hours". Verify its specific Save button activates and emits a specific toast on save.
6. Navigate to **Platform Settings**. Modify a Trading Control (e.g., Trading Halt). Ensure only the Trading Controls Save button activates.
7. Verify identical decoupled behavior across Market Data, Performance, and I18n tabs.
8. Navigate to **User Management** > KYC Queue and toggle the "Auto-promote Performer" switch. Ensure the save button activates and saving shows a specific KYC controls toast.
