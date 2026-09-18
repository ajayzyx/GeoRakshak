# GeoRakshak mobile (Expo)

Offline-first Android app for SIH26001 field officers and citizens: login, geo-tagged reports with photo and
≤30 s video, a local queue that syncs when the network returns, an alert inbox, and cached area risk.
GeoRakshak is a **decision-support** tool, not an official warning authority.

Stack (H3, [docs/development.md](../docs/development.md)): Expo SDK 57, React Native, TypeScript (strict).

## Requirements

- Node.js **22.13 or newer** (tests use Node's built-in `node:sqlite`; developed on Node 24)
- An Android phone with **Expo Go** (Play Store), on the same Wi-Fi as the laptop

## Install and run

```bash
cd mobile
npm install
cp .env.example .env        # optional; defaults to mock mode
npx expo start              # scan the QR code with Expo Go
```

If the phone cannot reach the laptop (guest Wi-Fi, client isolation), use `npx expo start --tunnel`.

## Modes

| `EXPO_PUBLIC_API_MODE` | What happens |
|---|---|
| `mock` (default) | In-app fictional backend (`src/mock/`). All data is `SIMULATED_DEMO`, the area is "Mock Area — not a real location", and a purple **MOCK DATA** banner is always shown. Sign in with `field.mock@example.org` (field mode) or `citizen.mock@example.org` (citizen mode) and any non-empty password. Mock server state resets when the app restarts; the device queue does not. |
| `live` | Calls the GeoRakshak backend at `EXPO_PUBLIC_API_BASE_URL` (default `http://localhost:8000/api/v1`). |

**Physical phone + live mode:** `localhost` on the phone is the phone. Set
`EXPO_PUBLIC_API_BASE_URL=http://<laptop LAN IP>:8000/api/v1` (macOS: `ipconfig getifaddr en0`), make sure the
backend listens on `0.0.0.0`, and restart `npx expo start` (Expo inlines `EXPO_PUBLIC_*` at bundle time). Plain
HTTP to a LAN IP works in Expo Go; a standalone build would need HTTPS or a cleartext exception.

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `EXPO_PUBLIC_API_MODE` | `mock` | `mock` or `live`. Anything else falls back to `mock`. |
| `EXPO_PUBLIC_API_BASE_URL` | `http://localhost:8000/api/v1` | Live mode only. No secrets belong in `EXPO_PUBLIC_*`: they are embedded in the bundle. |

`npm run check:live` uses its own variables (see below), not the `EXPO_PUBLIC_*` ones.

## Quality gates

```bash
npm run typecheck   # tsc --noEmit
npm test            # jest; no test touches the network
npx expo-doctor
npx expo export --platform android   # checks the bundle builds
npx expo export --platform ios
```

Tests run the app's real SQL on Node's built-in SQLite, against an in-memory fake of our backend's report
endpoints (`ContractServer` in `src/core/__tests__/helpers.ts`, which follows
`backend/app/routers/reports.py`: reporter-scoped idempotency, 409, 422 for `gps_accuracy_m <= 0` and
`duration_s > 30`, 404 for an unknown report).

`src/core/__tests__/offlineQueue.test.ts` holds the four areas required for this track:

| Area | Tests |
|---|---|
| (a) offline save | `(a1)` report + photo + video persisted, no network call · `(a2)` invalid draft not saved, issues per field · `(a3)` discard while offline |
| (b) restart persistence | `(b1)` queue survives closing/reopening the database file, then syncs · `(b2)` upload interrupted mid-way (app killed) resumes after restart, not duplicated |
| (c) reconnect sync | `(c1)` offline→online triggers a sync · `(c2)` reconnect retries at once despite a backoff timer · `(c3)` foreground and interval triggers, `stop()` ends the interval · `(c4)` runs never overlap; triggers during a run coalesce into one follow-up |
| (d) duplicate-safe sync | `(d1)` same `client_report_id` → 200, no second record · `(d2)` same `client_media_id` → 200 · `(d3)` crash after the server accepted, before local save → re-sent, 200, SYNCED · `(d3b)` lost response on a weak network · `(d4)` 409 from another reporter's id → FAILED, never retried · `(d5)` 409 media id → FAILED |

`capture.test.ts` covers the device capabilities with the ports mocked (no device, no emulator): camera and
location permission denied, a permission check that throws, cancelled capture, a camera that will not open,
unsupported MIME type, video longer than 30 s, video with unknown duration, oversized photo (before and after
the copy), an empty copy, a file-copy failure (with the copy deleted), no GPS fix / timeout / provider error,
and a low-accuracy or missing-accuracy fix. Each branch asserts the message the reporter sees.

`reportForm.test.ts` covers the form state machine the screen renders (GPS fix filling the position, the manual
pin winning a race with a late fix, comma decimals, the media limit, validation gating, busy and save errors)
and the category vocabulary. `crossPlatform.test.ts` guards that `src/core` imports no React Native, Expo or
Node modules and branches on no platform, and that `app.json` declares both platforms' permissions.

The other suites cover the engine (payload shape, `duration_s`, backoff, phase order, 413, 401, requeue when the
server no longer has the report, discard races), media limits, draft validation, inbox caching and offline
acknowledgement, auth, risk parsing and a mock-mode end-to-end flow.

### Opt-in live contract check (not part of jest)

```bash
npm run check:live                        # defaults to http://localhost:8002/api/v1
API_BASE_URL=http://localhost:8000/api/v1 LIVE_REPLAY_STEPS=20 npm run check:live
```

`scripts/check-live.ts` compiles `src/core` with the project's TypeScript into a temporary directory and runs it
under plain Node against a real backend, driving the **whole field-reporting chain**:

1. field officer signs in, `GET /me`, `PATCH /me` (language);
2. a mapped road segment beside a pilot village is chosen from `GET /layers/locations` and
   `GET /road-segments?bbox=` (the village with the fewest roads within 1 km, and a segment midpoint within
   800 m of it), so the outcome is deterministic rather than luck of the geometry;
3. a `ROAD_BLOCKED` report with a generated photo and a 12.5 s video is queued **with no network** (asserting
   that no request is sent);
4. the database file is closed and reopened (app restart), then synced: `POST /reports` (201) and
   `POST /reports/{id}/media` per file;
5. the backend's snap to the road segment is asserted (`road_segment_id`);
6. the same `client_report_id` and `client_media_id` are re-sent (both 200, no second record);
7. a video with `duration_s = 31` is rejected by the server (422) and marked FAILED without a retry loop;
8. citizen mode: a simplified report syncs and lands as `UNVERIFIED` (moderated);
9. the authority verifies the report (`POST /reports/{id}/verify`) — the call the web dashboard makes, not the
   app — and `effects.road_segment.status == "BLOCKED"` plus `effects.villages_access_at_risk` are asserted and
   printed;
10. the officer sees the segment as `BLOCKED` / `VERIFIED_REPORT` with `status_report_id`, the village's access
    reason shows one more blocked road, and — because `ACCESS_AT_RISK` requires *every* road within 1 km to be
    blocked or at risk — the authority overrides the remaining roads to show the village flip to
    `ACCESS_AT_RISK`;
11. the report reads back as `VERIFIED`, then inbox → acknowledge → `GET /risk/at`.

It exits non-zero on failure. Environment: `API_BASE_URL`, `DEMO_USER_PASSWORD`, `LIVE_OFFICER_EMAIL`,
`LIVE_CITIZEN_EMAIL`, `LIVE_AUTHORITY_EMAIL`, `LIVE_ADMIN_EMAIL`, `LIVE_REPLAY_STEPS` (steps the demo replay as
admin so alerts reach the inbox). An empty inbox or a point with no assessment yet is a warning, not a failure.
The check writes demo data (reports, a blocked road, overridden segments) into whichever backend it points at,
so point it at a sandbox database, not a demo you are about to present.

## Layout

```
App.tsx                 root: boot, session, state-based navigation
src/config.ts           env configuration
src/core/               pure TypeScript, injected dependencies, unit-tested, no platform APIs
  api.ts http.ts fetchHttpClient.ts   contract client (docs/api.md v1), error classification
  db.ts reportStore.ts localCache.ts  SQLite schema/migrations, ReportStore, cache, ack queue
  reportDraft.ts media.ts time.ts     form validation, api.md §5.7 limits, captured_at formatting
  capture.ts                          camera/storage/GPS behind ports (permissions, limits, timeouts)
  categories.ts reportForm.ts         category labels and the form state machine
  syncEngine.ts syncScheduler.ts      offline queue sync and its triggers
  inboxService.ts riskService.ts authService.ts
  pushRegistration.ts                 DISABLED placeholder for FCM (POST /me/devices)
src/mock/               mock backend + fixtures_simulated.ts (SIMULATED_DEMO)
src/shell/              React Native layer: Expo adapters, screens, UI primitives
scripts/                check-live.ts (opt-in contract check) + lib/ Node adapters (also used by the tests)
```

Navigation is a small state machine (login → tabs → report form) instead of expo-router/react-navigation: four
screens, no deep links, fewer dependencies. (The folder is `src/shell`, not `src/app`, because Expo treats
`src/app` as an expo-router root.)

## How the offline queue works

1. **Save:** the report and media rows are written to SQLite first (`client_report_id` / `client_media_id` are
   UUID v4, status `QUEUED` / `PENDING`). Photos/videos are copied into app storage (`report-media/`) first.
2. **Sync** (connectivity regained, app foreground, every 30 s while open, or "Sync now"). Runs never overlap;
   a trigger during a run schedules exactly one follow-up run. "Sync now" and reconnect ignore backoff timers,
   periodic and foreground runs respect them:
   - Phase 1: `POST /reports` for every queued report. `201` and `200` (duplicate) both mark it `SYNCED` and
     store the server id.
   - Phase 2: `POST /reports/{id}/media` (multipart) per file, photos before videos, small before large.
   - Network error, `5xx`, `408`, `429` → retry with exponential backoff (5 s doubling, capped at 10 min); a
     network error ends the run. `401` → keep queued, ask the user to sign in again. Other `4xx` → `FAILED` with
     the server message and no automatic retry (the user can tap Retry).
   - If a media upload gets `404` (the server no longer has the report, e.g. its database was reset), the report
     is queued again and re-sent; `POST /reports` is idempotent, so nothing is duplicated.
3. **Restart:** all state is in SQLite; `SYNCING` / `UPLOADING` rows go back to the queue on start.
4. Reports belong to the user who created them; signing out keeps them and they sync at that user's next
   sign-in.
5. A report that never reached the server (Queued or Failed, no server id) can be **discarded** from the device
   after a confirmation; its media files are deleted too. A report already on the server cannot be discarded
   here.

Status shown per report: Queued · Syncing · Synced · Media uploading · Failed, plus a line per file
(Waiting to upload / Uploading / Uploaded / Failed with the server's message).

## Category vocabulary

The seven categories from api.md §5.6 are fixed: `LANDSLIDE`, `CRACK`, `SEEPAGE`, `ROCKFALL`, `ROAD_BLOCKED`,
`SUBSIDENCE`, `OTHER`. Field wording only ever appears as a **label or hint** on one of those values
(`src/core/categories.ts`): "Landslide / slope movement", "Subsidence / sinking", and a line under the chips
stating that slope movement is sent as `LANDSLIDE`. No new enum value is introduced, and a test asserts the
label map covers exactly the frozen enum.

## Cross-platform

`src/core` is plain TypeScript with injected dependencies: no React Native, Expo, Node or platform branches
(enforced by `crossPlatform.test.ts`), which is why it also runs under Node in the tests and in `check:live`.
Everything platform-specific lives in `src/shell/adapters`. `app.json` configures both platforms: Android
permissions (`CAMERA`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`) and the iOS usage descriptions through
the `expo-image-picker` and `expo-location` plugin config (`supportsTablet: true`).

Verified here: `npx expo export --platform android` and `npx expo export --platform ios` both bundle. Nothing
has been run on an Android or iOS device. An iOS build would additionally need an `ios.bundleIdentifier`, an
Apple developer account (which the team does not have) and a macOS build (EAS or local Xcode); iOS is also
untested for the camera, GPS and SecureStore paths.

## Alerts, risk, language

- **Inbox:** polls `GET /me/inbox` every 15 s while the app is open (push is not connected, H8). The last
  successful list is cached with its "last updated" time. Acknowledge works offline (queued, sent later).
  Citizen mode never shows internal `WATCH` alerts. "Report from this alert" pre-links `alert_id`.
- **Area risk:** `GET /risk/at` for the current GPS position, cached with "last updated" and the disclaimer
  "Decision-support risk estimate. Not an official warning."
- **Reports:** the form validates per field (category, severity, description, location, accuracy, media count).
  A manually placed pin is disclosed as `location_adjusted_manually` **and** needs the reporter's uncertainty
  estimate in metres, because the backend requires `gps_accuracy_m > 0` on every report. Citizen mode shows the
  moderation note ("every citizen report is reviewed by the authorities before it is used").
- **Language:** `PATCH /me` `preferred_language` (`en`, `hi`). The pilot-area language option is disabled until
  the pilot area is selected (A12/H9). App UI strings are English-only in this MVP; alert title/body arrive
  already localised from the server.

## Not verified here

This machine has no Android SDK, no emulator and no iOS toolchain, so **nothing has run on a device**. What has
run: `npm run typecheck`, `npm test`, `npx expo export` for android and ios, and `npm run check:live` against a
real backend (which exercises the contract and the whole chain with the device capabilities mocked).

Strictly needs hardware (or at least an emulator/simulator):

- camera photo and video capture: real MIME types, the reported duration at the 29 s cap, real file sizes, and
  whether a 29 s clip stays under 25 MB on a given phone
- the permission dialogs themselves (camera, location) and the "denied, ask again in settings" paths
- GPS: time to first fix, reported accuracy, behaviour under tree cover, the timeout path
- copying a camera file into app storage, and a multipart upload of a real photo/video from a `file://` URI over
  a mobile network
- NetInfo connectivity events, the app-foreground trigger, SecureStore and expo-sqlite on device
- plain-HTTP calls from a phone to the laptop's LAN IP in live mode
- layout on a small screen and with Hindi alert text; the hardware back button
- anything iOS-specific (the app has never been built for iOS)

## Known limitations

- The camera caps recording at **29 s** (`videoMaxDuration`), one second below the frozen 30 s limit: Android can
  report a clip stopped exactly at the cap as 30.0x s, which the server rejects (`duration_s > 30` → 422). The
  client-side check still rejects anything over 30 s, matching the server.
- No video transcoding: a 29 s clip recorded at high quality can exceed 25 MB and is rejected with a hint to
  record a shorter clip. Photos are compressed (quality 0.6).
- Access tokens expire (`expires_in` 3600 in api.md §5.14) and the contract has no refresh endpoint, so a field
  officer offline for more than an hour must sign in again before the queue can sync. Queued data is kept.
- No background sync while the app is closed (not available in Expo Go).
- Local media files are kept after upload (media retention period is pending approval, A14).
- `POST /reports/sync` (batch) is not used; reports are sent one by one, which keeps per-item status simple.


## Presentation in a browser (no device)

The app also builds for the browser through `react-native-web`. This is a **presentation path only** — it exists so
the flow can be shown without an Android or iOS device. It is not a deployment target.

```bash
npm run demo:web          # exports the web bundle and serves it on http://127.0.0.1:5180
# or, with hot reload:
npm run web
```

What it shows: the MOCK DATA banner, login with the mock accounts, field vs citizen mode, the alert inbox with
DEMO badges, the full report form (all seven categories with their display labels, severity, description, GPS
state, manual pin, "Record video (up to 29 s)"), the queue with its statuses, and the area-risk screen.

Deliberate differences from the native build, because the browser has no equivalent:

| Native | Web | Consequence |
|---|---|---|
| `expo-secure-store` | `localStorage` | **Not secure storage.** Use the web build in mock mode only, never with real credentials. |
| NetInfo | `navigator.onLine` | The browser's offline mode drives the app's offline path, which is how to demonstrate queueing. |
| App foreground event | `visibilitychange` | Same sync trigger, different source. |
| Camera and GPS | Browser APIs, usually denied in a headless or desktop context | The form shows its honest permission-denied and no-accuracy messages, which is what a presenter narrates. |

**Verified here:** `expo export --platform web` bundles, and the exported build was driven in headless Chrome
through login → inbox → report form. **Not verified here:** anything on real hardware — no Android device, no
emulator, no iOS device or simulator has run this app.
