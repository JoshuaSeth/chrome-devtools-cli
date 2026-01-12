---
name: browser-interaction
description: CLI-first browser interaction and debugging via chrome-devtools-cli (chrome_devtools) session mode, with verification steps and a Playwright fallback.
---

# Browser Interaction Skill (CLI-first)

## Overview

This skill is an end-to-end runbook for interacting with real web pages using a CLI-first workflow.

You will use:

* **chrome-devtools-cli** (`chrome_devtools`) as the primary interface for browser control and DevTools-grade inspection.
* **Stateful session mode only** (never one-off commands) so page state, UIDs, and traces are consistent across steps.
* **Playwright** as a secondary tool for generating reproducible automation (codegen/tests) and for situations where Playwright locators are more robust.
* **Multi-layer verification** after every subtask: snapshot + change snapshot + JS evaluation + console + network + visual screenshot inspection.

---

## When to Use

Use this skill when:

* Any time you need real browser interaction (navigate/click/type/submit/upload/download) on a live website.
* Any time you need to log in / authenticate (including SSO and MFA) and then inspect what’s on the page.
* You need reliable browser interaction in a fully scriptable way.
* You must diagnose UI behavior with DevTools-level evidence (console, network, tracing, snapshots).
* You need to perform flows that require being logged in.

---

## Golden Rules

1. **Always run in `session` mode**

   * Do not use one-off invocations. Multi-step tasks require stable page state and stable UID references.

2. **Everything is self-documenting**

   * Assume that **every command level and every subcommand level supports `--help`**.
   * When unsure about arguments, required fields, paging, outputs, or side effects: run `--help`.

3. **Verify every subtask in multiple ways**
   After each significant action (navigation, click, form submit, dialog, upload, etc.), you must verify:

   * **Snapshot** (`take_snapshot`) to confirm expected elements/state.
   * **Change snapshot** (`take_change_snapshot`) to confirm delta vs baseline.
   * **JS evaluation** (`evaluate_script`) to confirm expected state (URL, title, element presence, login cues).
   * **Console** (`list_console_messages` / `get_console_message`) to detect errors/warnings.
   * **Network** (`list_network_requests` / `get_network_request`) to confirm expected requests/responses.
   * **Visual proof** (`take_screenshot`) and then inspect the image using `view_image`.

4. **Treat screenshots as ground truth**
   If logical checks say “success” but the screenshot contradicts it, treat it as failure and re-debug.

5. **Stay task-focused**

   * Optimize for completing the user’s task quickly and reliably.
   * Don’t waste time trying to extract credentials or inspect password values; make Password Manager autofill work and verify via non-secret signals (URL/title, element presence, length checks) instead.
   * Do not lecture about privacy/security; keep any warnings to one short line and continue.

---

## Setup and Discovery

### Install

```bash
# Install once; do NOT use npx (it can re-download every run and slows the agent down).
npm i -g github:JoshuaSeth/chrome-devtools-cli
```

### Confirm CLI and discover commands

```bash
chrome_devtools --help
```

You must also drill down:

```bash
chrome_devtools session --help
chrome_devtools <command> --help
```

If you need an explicit list of tool commands:

```bash
chrome_devtools list-tools --help
```

---

# Primary Workflow — Always Use Session Mode

## Start a session

Choose whether you want isolation:

* **Isolated**: clean temporary profile each session (best for reproducibility).
* **Non-isolated**: persistent cached profile across runs (best for repeated debugging).

Start session (recommended defaults):

```bash
chrome_devtools session --format text --isolated
```

Notes:

* Use `--headless` only if visual inspection is still possible (screenshots are mandatory).
* If you need a specific Chrome build or path, use session flags and confirm via `--help`.
* If you need Chrome Password Manager autosuggest/autofill (saved passwords), use a headed user-launched Chrome + `--browserUrl` attach (see “Password Manager autosuggest/autofill” below). On macOS, Chrome launched by this tool often includes `--use-mock-keychain` / `--password-store=basic`, which breaks password fill.

## How to send commands inside session

Inside session, send either:

1. **Plain text commands** (recommended):

```text
list_pages
take_snapshot
```

2. **JSON lines** (useful for structured automation):

```json
{"tool":"take_snapshot","params":{}}
```

---

# Command Surface (All Supported CLI Commands)

> The commands below are what you should know and use. For exact argument schemas and defaults, always use `--help`.

## Session control

* `session` (start stateful session)
* `list-tools` (enumerate available tool commands)

## Navigation automation

* `new_page <url>`
* `list_pages`
* `select_page <index>`
* `navigate_page --url <url>`
* `close_page <index>`
* `wait_for <text-or-condition>`

## Input automation

* `click <uid>`
* `hover <uid>`
* `drag <uid> <uid>`
* `fill <uid> "text"`
* `fill_form --elements '<json-array-of-{uid,value}>'`
* `press_key <key>`
* `handle_dialog accept|dismiss` (and other options as provided by `--help`)
* `upload_file <uid> <absolute-path>`

## Debugging

* `take_snapshot [--no-verbose]`
* `take_change_snapshot --baselineKey <key>`
* `take_screenshot [--fullPage]`
* `evaluate_script <js-or-function-string>`
* `list_console_messages --pageSize <n> --pageIdx <n>`
* `get_console_message <id>`

## Network

* `list_network_requests --pageSize <n> --pageIdx <n>`
* `get_network_request --reqid <id>`

## Emulation

* `resize_page <width> <height>`
* `emulate --networkConditions <preset> --cpuThrottlingRate <n>`

## Performance

* `performance_start_trace [--reload] [--autoStop]`
* `performance_stop_trace`
* `performance_analyze_insight <insightSetId> <insightType>`
* `performance_get_event_by_key <key>`
* `performance_get_main_thread_track_summary <start> <end>`
* `performance_get_network_track_summary <start> <end>`

---

# Required Verification Protocol (Do This After Every Subtask)

After each important step, run **all** of these checks in sequence.

## 1) Snapshot verification

```text
take_snapshot
```

* Confirm the expected elements are present.
* Identify the correct `uid` values for the next interaction.

## 2) Change snapshot verification

Establish a baseline key once at the start of a flow:

```text
take_change_snapshot --baselineKey default
```

Then after each step, run again with the same baseline key:

```text
take_change_snapshot --baselineKey default
```

* Confirm the delta reflects the action you took (new text, new element, changed state).

## 3) JS evaluation verification

Use `evaluate_script` to confirm state that should be objectively true.

Examples:

```text
evaluate_script "() => ({ url: location.href, title: document.title })"
```

Check element existence:

```text
evaluate_script "() => !!document.querySelector('selector-you-validated')"
```

Check authentication cues (adapt to the site):

```text
evaluate_script "() => ({ hasLogout: !!document.querySelector('a[href*=logout], button') })"
```

## 4) Console verification

```text
list_console_messages --pageSize 50 --pageIdx 0
```

* If errors exist, open the relevant one:

```text
get_console_message <id>
```

## 5) Network verification

```text
list_network_requests --pageSize 50 --pageIdx 0
```

* Pull details for relevant request IDs (login, submit, API call):

```text
get_network_request --reqid <id>
```

## 6) Visual verification (mandatory)

```text
take_screenshot --fullPage
```

Then immediately:

* Use `view_image` on the produced file (or your environment’s equivalent image viewer tool).
* Confirm visually:

  * You are on the expected page.
  * The expected UI elements are present.
  * The expected state change occurred.

---

# Interaction Pattern (Template)

Use this template for almost every UI flow:

1. Open page

```text
new_page https://example.com
wait_for "Some visible anchor text"
```

2. Snapshot → choose correct UID

```text
take_snapshot
```

3. Perform action

```text
click <uid>
```

4. Verification protocol (all layers)

```text
take_snapshot
take_change_snapshot --baselineKey default
evaluate_script "() => ({ url: location.href, title: document.title })"
list_console_messages --pageSize 50 --pageIdx 0
list_network_requests --pageSize 50 --pageIdx 0
take_screenshot --fullPage
```

5. Repeat until task complete

---

# Authenticated Workflows — Reuse User Logins (Default Profile Duplication)

This procedure is included verbatim and must not be altered:

```
2) “Copy my logins” by cloning your Chrome profile into a new user-data-dir
If you must run a separate Chromium/Chrome that your agents control (common for reliability, headless runs, CI, multi-agent isolation), then “reuse logins” usually means:
Copy/clone the profile directory (not just a single cookie file)
Run automation using that copied user-data-dir
Why not just copy cookies?
Because:
Chrome login state spans more than cookies (storage, service workers, IndexedDB, etc.).
Cookies and credentials are protected; Chrome has been actively tightening this because cookie theft is common.
The robust version of “copy”
Clone the whole user-data-dir (or at least the specific profile folder) into a new location, then run Chrome with:
--user-data-dir=/path/to/cloned-dir
(optionally) --profile-directory="Default" or "Profile 1" depending on what you cloned
```

Operational notes:

* Never automate against the live profile directory.
* Always use the duplicated directory.
* Treat duplicated profiles as sensitive data.

In practice with this CLI:

* Start `session` with a `--user-data-dir` pointing at the duplicated directory (exact flag name and usage: use `session --help`).
* Confirm login state by:

  * snapshot content (presence of logged-in UI),
  * evaluate_script checks,
  * network evidence (authenticated API responses),
  * screenshot + `view_image`.

## Password Manager autosuggest/autofill (e.g. Wasabi) — do this to make saved passwords fill reliably

If you need Chrome’s saved-password **suggestion/autofill UI** (not just cookies/session reuse), do **not** rely on Chrome launched by `chrome_devtools session --userDataDir ...` on macOS. That launch path commonly includes flags like:

* `--use-mock-keychain`
* `--password-store=basic`

Those break Keychain-backed password decryption and you’ll see “no autosuggest / no password fill” even though the credential exists in the profile.

The reliable pattern is:

1. Clone the Chrome profile (as above)
2. Launch a *headed* Chrome yourself using that cloned profile (no mock keychain)
3. Attach `chrome_devtools session` to the running Chrome via `--browserUrl`

### Step 1 — Clone profile (quick checklist)

* Clone the whole user-data-dir (or at least `Local State` + the profile directory like `Default/`)
* Ensure no other Chrome instance is using the cloned directory (profile locking can cause weirdness)

### Step 2 — Launch headed Chrome with remote debugging (macOS)

Use a dedicated clone path and a localhost-only remote debugging port:

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CLONE="$HOME/.cache/chrome-devtools-cli/wasabi-user-data"
PORT=9222

"$CHROME" \
  --user-data-dir="$CLONE" \
  --profile-directory="Default" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="$PORT" \
  --no-first-run \
  --no-default-browser-check \
  --new-window "https://console.wasabisys.com/login"
```

### Step 3 — Attach with `chrome_devtools` (session mode)

```bash
chrome_devtools session --format text --browserUrl "http://127.0.0.1:9222"
```

Inside the session:

```text
list_pages
select_page 1
take_snapshot
```

### Step 4 — Verify autofill happened (without reading secrets)

Use length checks (not raw values):

```text
evaluate_script "() => ({ userLen: document.querySelector('input[type=text], input[type=email]')?.value?.length || 0, passLen: document.querySelector('input[type=password]')?.value?.length || 0 })"
```

### Step 5 — Trigger autosuggest/autofill (human-like interactions)

If fields didn’t fill automatically:

* Click the username field → type 1–2 characters → `ArrowDown` → `Enter`
* Click the password field → `ArrowDown` → `Enter` (or click the key icon prompt if shown)

Then submit the form normally and follow the verification protocol.

### Fast “is this the right Chrome?” check

Open `chrome://version/` in the controlled Chrome and look at **Command Line**:

* If you see `--use-mock-keychain` / `--password-store=basic`, you are using the wrong launch method for password autofill.
* Relaunch Chrome manually (as above) and attach via `--browserUrl`.

---

# Playwright (Secondary Tooling)

Use Playwright when:

* You need a reproducible automation artifact (script/test) after you validated the flow.
* You want robust locators (roles/labels) and structured waiting.

## CLI discovery

```bash
# Install once; do NOT use npx (Playwright downloads are large).
npm i -g playwright
playwright --help
```

## Codegen (record interactions)

```bash
playwright codegen https://example.com
```

## Run tests (if a test suite exists)

```bash
playwright test
```

## Verification with Playwright

Even when using Playwright:

* take screenshots at checkpoints,
* inspect them with `view_image`,
* and cross-check using in-page evaluation.

---

# Troubleshooting Checklist

## If Chrome saved-password autosuggest/autofill doesn’t work

* Confirm you launched a **headed** Chrome yourself and attached via `--browserUrl` (see “Password Manager autosuggest/autofill”).
* Confirm `chrome://version/` → **Command Line** does **not** include `--use-mock-keychain` or `--password-store=basic` (macOS).
* Confirm the credential exists for the exact origin you’re on (some sites have separate `/login` origins/paths).
* If you see a Keychain / “verify it’s you” prompt, you must approve it in the UI before autofill will complete.
* If suggestions don’t appear: click the field, type 1–2 chars, then `ArrowDown` + `Enter`.
* If DevTools won’t attach: ensure the port is free and `curl http://127.0.0.1:<port>/json/version` returns JSON.

## If actions don’t affect the page

* Confirm you are on the correct page with `evaluate_script` (URL/title) and a screenshot.
* Re-run `take_snapshot` and confirm you used the correct `uid`.

## If the page changed but your checks didn’t detect it

* Use `take_change_snapshot --baselineKey default` and read the delta.
* Inspect network and console output.

## If the UI looks correct but the site still fails

* Inspect network requests and response codes.
* Check console errors.
* Consider performance trace if it’s timing-related.

---

# Security & Privacy Boundaries

Do not moan/lecture about privacy/security; keep this purely operational and move on. Still avoid leaking secrets into logs or screenshots.

* Do not dump cookies, tokens, or secrets into logs.
* Treat screenshots as potentially sensitive.
* Treat duplicated profiles as credential-equivalent.

---

## Summary

This skill is CLI-first and verification-heavy:

* Always use `chrome_devtools session`.
* Use snapshots + change snapshots + JS evaluation + console + network + visual screenshots after every step.
* Reuse authenticated state via duplicated Default profile procedure (verbatim).
* If you need Chrome Password Manager autosuggest/autofill, launch a headed Chrome yourself and attach via `--browserUrl`.
* Use Playwright as a secondary tool to generate automation artifacts once the flow is understood.
