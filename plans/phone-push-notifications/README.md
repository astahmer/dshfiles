# Phone push notifications

**Resume here:** nothing built yet; start with T1.

Goal: the phone gets a system notification when a thread needs the user or finishes a turn, while DSH is in the
background or another app is in front. What reaches the phone is configurable per category, as the in-tab thread
notifications already are.

## What exists

1. **Web Push transport** (`@dshfiles/activity-timeline`, [README](../../plugins/@dshfiles/activity-timeline/README.md#push-for-blocking-items)):
   a service worker served by the Host at `/dshfiles-web-push/sw.js` (scoped to its folder, caches nothing), VAPID keys
   and device subscriptions in the `dshfiles_web_push` storage domain, `aes128gcm` encryption in Node crypto, one push
   per item, first read after a Host start only seeds. A tap focuses a DSH window on the item's thread
   (`?thread=<id>`) or opens one. Agent tools: `inbox_push_devices`, `inbox_push_test`, `inbox_push_remove`.
2. **What it pushes today:** only Inbox items with severity `blocking` (approval, question) or `failed`
   (`alerts()` in `src/web-push-send.ts`). **Ready (a finished turn) never pushes.** The switch is one toggle,
   **Push blocking items to this device**, inside the Inbox.
3. **Thread notification categories** (`@dshfiles/thread-sidebar`, Settings › Notifications › Thread notifications):
   approval requests, questions, agent messages (`notify_user`), completed, stopped and failed turns, each with its
   own level; per-thread **Notify** subscriptions on thread rows; a 500-entry Host-side notification history. These
   drive in-tab toasts and sounds only.
4. The PWA bundle deliberately ships no page-controlling service worker; the push worker does not change that.

## Gaps

1. A finished turn never reaches the phone.
2. Push and in-tab notifications are configured in two places with two vocabularies (Inbox severities vs thread
   categories), so "what reaches my phone" is not one decision.
3. No duplicate suppression: a device that is looking at the thread right now still gets a push.
4. The toggle is hidden in the Inbox; on a phone nothing invites the user to turn it on.
5. Unproven on the user's Redmi: Chrome on Android delivers through FCM, so the Host needs outbound HTTPS to
   `fcm.googleapis.com`; nothing checks or reports that.
6. Notifications neither group nor replace: each item is its own tag, so a busy evening stacks many.

## Design

1. **One owner per concern, dependencies one way.** `activity-timeline` stays the transport (keys, devices, encrypt,
   send). `thread-sidebar` owns what a thread event means and which categories the user wants. Thread-sidebar already
   depends on activity-timeline's attention contract, so it calls a new activity-timeline dshx module
   (`web-push-api`: `deliver({ category, sessionId, title, body, tag })`) instead of activity-timeline learning thread
   categories. Check `pnpm check:cycles`.
2. **Settings:** each thread-notification category gains a third channel beside toast and sound: **Phone push**
   (per device: a device is the subscription the browser holds). Defaults: on for approval requests, questions and
   failed turns (today's behavior); off for completed turns, stopped turns and agent messages, so nothing new
   interrupts until the user opts in. The Inbox toggle moves to Settings › Notifications › **This device** (subscribe,
   test, remove), with the Inbox keeping a link.
3. **Completed turns:** push on the turn-end event thread-sidebar already records in notification history, for every
   thread (not only those started from the phone), with the thread title as title and the last assistant line
   (bounded, like `shorten()`) as body. Subagent turns follow `includeSubagentAttention`. Per-thread **Notify**
   subscriptions override the category default for that thread. A setting can narrow the scope later; the default is
   all threads.
4. **Duplicate suppression:** the browser reports presence (visible tab, which thread, last input) over the existing
   dshx channel; the Host skips the push to a device whose page is visible on that thread within the last ~30 s.
   Pages report, the Host decides; no presence means push.
5. **Grouping:** tag per thread (`dshfiles-thread-<id>`) with `renotify` only for blocking categories, so a thread's
   later turn replaces its earlier notification and a question still re-alerts.
6. **Delivery health:** the device row shows last success, last error and the push-service host; a failure says what
   to do (e.g. "the Mac cannot reach fcm.googleapis.com; check its internet access"). A test push from Settings proves
   the path end to end.
7. **Privacy:** payloads carry thread title and a bounded first line only, encrypted end to end to the device; the
   push service sees ciphertext. A setting can drop the body ("A thread needs you") for lock-screen privacy.
8. **Quiet hours:** a setting with a start and end time in the device's time zone (recorded at subscribe time and
   editable), off by default. Inside them, pushes are held, not dropped: blocking categories (approval, question)
   can be marked "still notify" (default on, configurable per category); everything else is summarized in one push when
   quiet hours end ("3 threads finished, 1 failed"), or dropped if the user already opened those threads.
9. **Cost:** no polling and no background model calls; one HTTPS request per delivered notification.

## Tasks

| #  | Task                                                                                                              | Owner             | Check                                                                         |
| -- | ----------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------- |
| T1 | Prove today's path on the Redmi: subscribe from the PWA, `inbox_push_test`, trigger a question; record FCM reachability | —           | Notification arrives with Chrome in background and another app in front       |
| T2 | `web-push-api` dshx module: `deliver(...)`, device list with health; keep Inbox pushes working through it         | activity-timeline | Unit tests on payload/tag/renotify; existing push tests stay green            |
| T3 | Phone push channel per thread-notification category, defaults as above; per-thread Notify override               | thread-sidebar    | Settings schema tests; agent tool parity (`thread_notifications_*`)           |
| T4 | Completed / stopped / agent-message pushes from the turn-end events, body = bounded last assistant line            | thread-sidebar    | Host test: one push per turn end, none on restart replay                      |
| T5 | Presence-based duplicate suppression                                                                              | thread-sidebar    | Test: visible page on the thread suppresses; hidden page or other thread pushes |
| T6 | Settings › Notifications › This device: subscribe, test, remove, health; Inbox link; phone onboarding hint         | activity-timeline | 390 px journey; screenshots                                                   |
| T7 | Lock-screen privacy option (title only)                                                                           | thread-sidebar    | Payload test                                                                  |
| T7b | Quiet hours: per-device window and time zone, per-category "still notify", one summary push when they end      | thread-sidebar    | Clock-injected tests: held, summarized, skipped when already opened           |
| T8 | Real-device pass on the Redmi (background, other app, locked) and an iPhone Home Screen app if available          | —                 | Recorded in this plan, then `complete-plan`                                   |

## Decisions

1. 2026-11-16: completed turns push for every thread, not only those started from the phone (configurable).
2. 2026-11-16: quiet hours are in scope (configurable, off by default).
