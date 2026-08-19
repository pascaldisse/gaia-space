# HANDOFF — GAIA Space mobile Tauri app (2026-08-19)

## Ask
Pascal: "gaia space should also be installable on phone (and connect to our
server or server of choice)" → corrected to "i said tauri app" (real native
Tauri iOS app, not a PWA/add-to-homescreen answer).

## Status: DONE and verified on real hardware. Real device build succeeded,
## installed + launched on Pascal's iPhone 13 mini via devicectl, and he
## confirmed by sending his own screenshot from the actual phone (matches
## the simulator render 1:1). A follow-up nav/UX fix (collapsible mobile
## drawer) also landed and was verified against a real authenticated
## backend. Nothing here is committed yet — see "Next steps".

## What exists now (this session, uncommitted)

### 1. Cargo.toml split (`src-tauri/Cargo.toml`)
Moved all desktop/server-only native deps into a target-conditional block:
```
[target.'cfg(not(any(target_os = "ios", target_os = "android")))'.dependencies]
rusqlite, git2 (vendored-libgit2), dirs, chrono, jsonwebtoken, axum, tokio,
argon2, rand, hex, chacha20poly1305, base64
```
Reason: these back the *desktop* native app (local sqlite db in `db.rs`,
vendored libgit2 repo tools in `git.rs`/`review.rs`) and the `space-server`
HTTP binary's crypto/web stack — none of it is needed by a thin mobile
client, and cross-compiling vendored libgit2 for iOS is the kind of thing
that eats hours and breaks. Excluding it at the Cargo level means the iOS
build never touches it. `tungstenite` (debug door, pure Rust) stays
unconditional — works fine on iOS, kept the debug bridge alive on mobile.
`objc2`/`block2` untouched (already `cfg(any(macos, ios))`, and the only
objc2-using code in `debug_server.rs` is already `#[cfg(target_os = "macos")]`
so it's inert-but-present on iOS, harmless).

### 2. `src-tauri/src/lib.rs`
- Gated the desktop-only `pub mod` lines (`chat, db, documents, git, issues,
  meetings, calls, pipelines, platform, personal, review, secretbox`) behind
  `#[cfg(desktop)]` (Tauri's built-in target-family cfg — mac/win/linux, set
  by `tauri-build`'s `build.rs`, which only runs when Cargo feature
  `"desktop"` is on — that feature is unrelated to the `desktop`/`mobile`
  target cfg, it's the existing "does this crate include the `tauri` dep at
  all" switch used to build the headless `space-server` bin).
- Split `run()` into two mutually-exclusive definitions:
  - `#[cfg(all(feature = "desktop", desktop))] pub fn run()` — unchanged,
    the existing 150+-command local-first native app.
  - `#[cfg(all(feature = "desktop", mobile))] pub fn run()` — new. Thin
    shell: one `WebviewWindowBuilder` with `WebviewUrl::External(url)`,
    `url` from `resolve_space_url()` (runtime env `GAIA_SPACE_MOBILE_URL` →
    compile-time `option_env!("GAIA_SPACE_MOBILE_URL")` → hardcoded fallback
    `https://151.115.73.182/space/`). Exact same pattern as gaia-daemon's
    `resolve_url()` in its own `src-tauri/src/lib.rs` — "server of choice" is
    just whatever URL you bake in / pass at runtime.
  - Both keep `debug_server::spawn` (app-tools debug door, port 9433 default,
    see `GAIA_SPACE_DEBUG_PORT` env, `src/debug_server.rs`).

### 3. New iOS scaffold files (mirrors gaia-daemon's)
- `src-tauri/Info.ios.plist` — `NSAllowsArbitraryLoads: true` (ATS bypass;
  ATS only gates TLS version/PFS, does **not** bypass certificate-trust
  checks — see cert note below), `NSLocalNetworkUsageDescription`.
- `src-tauri/tauri.ios.conf.json` — `developmentTeam: "T2253T7WJE"` (same
  team as gaia-daemon's existing iOS app, already registered).
- Ran `bun run tauri ios init` → generated `src-tauri/gen/apple/` Xcode
  project (this dir is gitignored/regenerable, not meant to be committed as
  source-of-truth — the source-of-truth is the plist/conf files above).

## Verified (real testing, not claims)

1. **`cargo check` regression-clean**: desktop lib build unaffected
   (`cargo check`), `space-server` bin unaffected (`cargo check --bin
   space-server`) — both still pull the full dep set as before.
2. **iOS lib compiles with zero heavy deps**: `cargo check --target
   aarch64-apple-ios-sim --lib` — clean, fast (no libgit2/sqlite cross-compile
   attempted).
3. **Real simulator build succeeded**: `tauri ios build --debug --target
   aarch64-sim` with `GAIA_SPACE_MOBILE_URL=https://151.115.73.182/space/` →
   `BUILD SUCCEEDED`, app at `src-tauri/gen/apple/build/arm64-sim/GAIA
   Space.app`.
4. **Installed + launched on iPhone 17 Pro simulator** (`xcrun simctl install`
   + `simctl launch com.gaia.space`), **took a real screenshot** (not
   assumed) — confirms the webview actually navigated to and rendered
   `https://151.115.73.182/space/`: header "GAIA Space", nav "Overview",
   real content ("Your work, calendar, notification feed..."), an "Acting
   as" profile picker mid-fetch ("Loading profiles...").
5. **Self-signed cert is NOT blocking the page load** in practice, despite
   Caddy on `151.115.73.182` using `tls internal` (self-signed) — the page
   fully rendered. (I expected `NSAllowsArbitraryLoads` to be insufficient
   for cert-trust and was ready to need a real cert; tested it directly
   instead of assuming, it just works with the current plist.)

## "Loading profiles" — RESOLVED, was auth state, not a bug

Traced it at the time to `POST /space/api/cmd/list_profiles` → **401** when
unauthenticated. Confirmed the theory later while verifying the nav fix
below: with a **real logged-in session** the exact same Overview screen
renders full real data ("Acting as Administrator...", Open to-dos, Assigned
issues, etc. — no spinner). So this was never a mobile/Tauri bug — it's
just what an unauthenticated Overview looks like, same in any browser.
Open product question (not mine to decide): should an unauthenticated hit
on that screen redirect to login instead of spinning forever? Didn't find a
visible login entry point from Overview — worth a look, low priority.

(Separately, my `debug_server` `/eval` bridge on port 9433 timed out both
times I tried it against the loaded external page in the simulator —
`/console`/`/info` work fine, `/eval` specifically didn't; not chased
further, not blocking anything.)

## Real-device build + install (completed)

```
GAIA_SPACE_MOBILE_URL="https://151.115.73.182/space/" bun run tauri ios build --debug
```
**BUILD SUCCEEDED** → exported `.ipa` + `.app` at
`src-tauri/gen/apple/build/gaia-space_iOS.xcarchive/Products/Applications/GAIA Space.app`.
Log: `/tmp/gaia-space-ios-device-build.log`. Had to do a one-time manual
`xcodebuild -allowProvisioningUpdates -allowProvisioningDeviceRegistration
-destination "id=00008110-001459E80E98401E"` pass first (same class of
"team has no devices" provisioning-registration loss gaia-daemon hit on
2026-07-24/08-14 after Xcode updates) — fixed now for this project too.
**Xcode's device id for Pascal's iPhone is `00008110-001459E80E98401E`, NOT
the devicectl UDID `D23DA607-1877-58A8-B672-948DB9BF396E`** — different id
namespaces, don't reuse one for the other (devicectl UDID is what
`device install app`/`device process launch` want; the Xcode id above is
only for `xcodebuild -destination`).

Installed + launched for real:
```
xcrun devicectl device install app --device D23DA607-1877-58A8-B672-948DB9BF396E \
  "src-tauri/gen/apple/build/gaia-space_iOS.xcarchive/Products/Applications/GAIA Space.app"
xcrun devicectl device process launch --device D23DA607-1877-58A8-B672-948DB9BF396E com.gaia.space
```
Both succeeded (`bundleID: com.gaia.space`, real installationURL, `Launched
application with com.gaia.space bundle identifier`). **Pascal confirmed by
sending his own screenshot from the real phone** — shows the actual
`GAIA Space` header/nav chrome and live-fetched "Loading profiles..." state,
pixel-identical to the simulator render above. Real native Tauri iOS app,
on the real device, done.

## Mobile nav fix (same session, follow-up ask)

Pascal, from his real-phone screenshot: "top menu is unresponsive, shows
only one option. maybe a collapsable side menu on the left would be better?
for both versions" — the top nav (`src/nav.ts`, 8 groups) was only ever
horizontally scrollable with zero visible affordance that it scrolled, so
at phone width it just clipped after "Overview".

**Fix** (`src/App.tsx`, `src/App.css`, `src/components/Icon.tsx`): hamburger
button + collapsible left drawer below a 720px breakpoint, reusing the exact
same `nav`/`groupNav` render functions as the desktop top bar (so it covers
both `NavLayout` variants — `grouped` and `flat` — for free, and applies
uniformly to the Tauri app and the web build since it's plain responsive
CSS, not platform-specific). Drawer closes on backdrop click, Escape, or
navigating to a destination.

**Caught+fixed my own bug before shipping**: first pass, the `@media
(max-width: 720px)` block was positioned *before* the base `.topnav{...}`
rule in `App.css` — at equal specificity CSS resolves ties by source order,
not media-query-match, so the always-visible rule kept winning regardless of
viewport. Moved the media block after the base rules it needed to override;
re-tested; fixed.

**Verified live, not guessed**: stood up a real scratch `space-server` (own
port 8099 + own sqlite db, unrelated to the pre-existing dev instance
already running on the default port 8090 — left that alone, not mine),
built the real `dist-web` bundle, logged in for real (`admin`/scratch
password), drove it with headless Brave via CDP at 390x844 (phone) and
1400x900 (desktop):
- Closed drawer, mobile: hamburger + brand + search + account, full real
  dashboard content (proves the "Loading profiles" theory above too).
- Open drawer, mobile: all 8 destinations, icons, active-state highlight,
  backdrop.
- Tapped "Calendar" in the drawer → real client-side nav to `/space/calendar`,
  drawer auto-closed, real calendar grid rendered.
- Desktop width (1400px): hamburger hidden, full 8-item horizontal nav
  intact — zero regression.
All scratch processes/db/files cleaned up afterward.

## Next steps (pick up here)

1. **Nothing is committed yet.** Dirty/new in the worktree:
   `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/Info.ios.plist`,
   `src-tauri/tauri.ios.conf.json`, `src/App.tsx`, `src/App.css`,
   `src/components/Icon.tsx`, this file. `src-tauri/gen/` (Tauri-generated
   Xcode project) is untracked and NOT currently gitignored (only
   `/gen/schemas` is, per `src-tauri/.gitignore`) — decide whether to add
   `/gen/apple` to gitignore (large, regenerable via `tauri ios init`) or
   track it like gaia-daemon does its own `gen/apple`. Pascal's call.
2. First app launch on a fresh device may still hit the usual one-time
   "untrusted developer" trust gate (Settings → General → VPN & Device
   Management) — known Apple behavior, not a bug; didn't hit it this run
   since the team/cert was already trusted from the gaia-daemon app.
3. Optional follow-up Pascal raised earlier: swap the raw-IP + self-signed
   cert on `151.115.73.182` for a real domain + Let's Encrypt/ZeroSSL cert
   (Caddy 2.10.2 there supports automatic IP certs too) — not done, not
   blocking, current cert works fine for the webview as-is.
4. Low-priority product question flagged above: should an unauthenticated
   hit on Overview redirect to login instead of spinning forever?
