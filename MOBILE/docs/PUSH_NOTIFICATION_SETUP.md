# Wrapper Push Notification Setup Guide

## Scope

This document covers the Capacitor wrapper push contract in `MOBILE/`. The server-side registry already exists under `/api/push/*`.

## Current State

- Wrapper clients register and revoke device tokens through:
  - `POST /api/push/register`
  - `POST /api/push/unregister`
  - `GET /api/push`
- The wrapper sends `appVariant: "wrapper"` and includes environment, locale, timezone, app version, build number, and device identity metadata.
- Android is the concrete repo-validated wrapper push path today.
- iOS wrapper push still requires operator-side Apple/FCM/APNs provisioning before release.

## Android Wrapper Setup

1. Create/register the Android app in Firebase with package id `com.tradequip.app`.
2. Download `google-services.json`.
3. Place it at `MOBILE/android/app/google-services.json` for the target environment.
4. Ensure notification click targets and app-link domains resolve to `https://tradehub.example.com`.

## iOS Wrapper Setup

1. Create/register the iOS app in Apple Developer and, if using Firebase mediation, in Firebase as well.
2. Enable push notifications and associated domains for the wrapper bundle id.
3. Provide the correct APNs/Auth Key or Firebase-backed APNs configuration for the release environment.
4. Validate notification landing paths against the live web routes listed below.

## Backend Payload Contract

Wrapper clients should send a token payload shaped like:

```json
{
  "token": "<device token>",
  "appVariant": "wrapper",
  "platform": "android",
  "environment": "production",
  "pushProvider": "FCM",
  "deviceId": "<stable device id>",
  "deviceInstallId": "<stable install id>",
  "appVersion": "<app version>",
  "buildNumber": "<build number>",
  "locale": "en-US",
  "timezone": "America/Chicago",
  "metadata": {
    "wrapperMode": "remote-url"
  }
}
```

The server stores the token in the shared `push_devices` registry, scopes it to the authenticated user, and revokes it on logout when the wrapper clears the active token.

## Supported Notification Targets

Wrapper notification payloads should map into real app routes only:

- `/`
- `/?tab=quotes`
- `/?tab=chart&symbol=USDJPY`
- `/?tab=trade&symbol=USDJPY`
- `/?tab=history`
- `/?tab=leaderboard`
- `/?tab=account`
- `/?tab=account&panel=mailbox`
- `/profile`
- `/journal`
- `/verify-email?token=...`

Avoid legacy wrapper-local routes such as `/settings`, `/account`, `/chart/:symbol`, or `/trade/:symbol` unless they are being normalized into the query-backed dashboard contract first.

## Release Notes

- Do not treat tracked Firebase files as authoritative production credentials.
- Replace placeholder or environment-mismatched config files before release.
- Validate registration and logout-driven revocation on both wrapper platforms as part of release testing.
