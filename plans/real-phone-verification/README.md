# Real-phone verification

**Resume here:** nothing set up; deferred by the owner (2026-11-16). Start at T1 when a phone bug needs it.

Goal: an agent can check phone behavior on the owner's real phone, not only in a desktop Chromium that imitates one.
That covers attaching to the DSH tab the owner is using, scripted journeys on real hardware, and the cases emulation
cannot reproduce: lock and unlock, Doze, the HyperOS keyboard and text selection toolbar, the gallery picker, a
silently dropped Tailscale link.

## Why

Phone bugs fixed this month were proven only in headless Chromium with an Android user agent: the return key, image
uploads (cut-short gallery JPEGs), the selection Quote/Annotate buttons, the blank thread after unlock, the reachability
banner. Several needed the owner to retest by hand, and some symptoms never reproduced on the Mac (Redmi Chrome reports
a hover-capable pointer; the native selection toolbar and handles do not exist in emulation; lock/resume and Doze cannot
be emulated faithfully).

## What we found (2026-11-16)

1. **The phone is reachable.** `tailscale status` lists `redmi-note-15-pro-5g` (100.100.76.70, Android, active, direct
   connection), so the Mac can reach it on mobile data too, without a cable.
2. **Tools exist in nixpkgs:** `android-tools` 37.0.0p1 (`adb`) and `scrcpy` 5.0.1. Neither is installed; per the
   machine rules they go in nixfiles, not a global install.
3. **Two attach paths:**
   1. **Chrome DevTools Protocol on the existing tab.** `adb forward tcp:9222 localabstract:chrome_devtools_remote`
      exposes the phone's Chrome; Playwright `chromium.connectOverCDP('http://localhost:9222')` (Playwright 1.56 is in
      the repo) attaches to the DSH tab already open, including the installed PWA, without reloading it: screenshots,
      DOM, console, network, performance traces, touch input. Desktop `chrome://inspect` uses the same channel.
   2. **Playwright Android (experimental, `_android`).** Launches its own Chrome context on the device for scripted
      journeys. Needs Chrome 105+, `adb` authorized, `chrome://flags` → *Enable command line on non-rooted devices*, and
      the screen awake for screenshots ([docs](https://playwright.dev/docs/api/class-android)).
4. **What `adb` adds beyond emulation:** `input keyevent 26` (power: lock / wake), `dumpsys deviceidle force-idle`
   (Doze), `screencap -p`, `screenrecord`, `input tap/swipe`, and `scrcpy` to mirror and drive the screen from the Mac.
5. **Wireless over Tailscale:** Android's *Wireless debugging* only runs on Wi-Fi and its port changes. After one pairing
   (`adb pair <ip>:<port> <code>`), `adb tcpip 5555` makes adbd listen on every interface, so `adb connect
   100.100.76.70:5555` then works through Tailscale on 5G. That mode lasts until the phone reboots; HyperOS may also
   drop it.

## Limits and risks

1. **Full control while on.** With adbd on 5555, anything on the tailnet that reaches that port controls the phone, and
   the Chrome channel reads every Chrome tab, not only DSH. Mitigations: a Tailscale ACL that allows port 5555 only
   from the Mac; agents attach to the DSH target only (match the tailnet origin) and never list or read other tabs;
   `adb usb` or a reboot closes it after each session.
2. **PIN lock.** `adb` can wake the screen but not unlock a PIN; unlock-dependent checks need the owner to unlock while
   the agent captures.
3. **Re-pairing** after each reboot (Wi-Fi needed for that step only).
4. **iPhone** needs its own path: Safari Web Inspector over a USB cable from the Mac (Settings › Safari › Advanced ›
   Web Inspector on the phone), or `ios-webkit-debug-proxy` for scripted CDP-like access; no lock/wake control.
5. **Not covered:** perceived smoothness (frame timings can be measured, feel cannot).

## Tasks

| #  | Task                                                                                                                         | Owner           | Check                                                                     |
| -- | ---------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------- |
| T1 | Owner, once: Developer options (tap *OS version* ×7), *USB debugging*, *USB debugging (Security settings)* (HyperOS, Xiaomi account), *Wireless debugging* on Wi-Fi, send the pairing IP:port and code | owner | Pairing code received                                                       |
| T2 | nixfiles: add `android-tools` and `scrcpy` to the macbook host packages; `nixapply`                                          | nixfiles        | `adb version`, `scrcpy --version`                                         |
| T3 | Pair, `adb tcpip 5555`, `adb connect 100.100.76.70:5555`; record the steps                                                   | agent + owner   | `adb devices` lists the Redmi over Tailscale                              |
| T4 | Tailscale ACL: port 5555 on the phone only from the Mac (owner's admin console)                                              | owner           | Another tailnet device cannot connect                                     |
| T5 | `scripts/phone/attach.mjs`: forward 9222, find the DSH target by origin, attach read-only by default; screenshot, console, network summary, trace; never print the launch token; refuse other targets | dshfiles | Attaches to the live DSH tab without a reload; output redacted            |
| T6 | Journeys on the real phone: lock/resume (blank thread), image upload from the gallery, Quote/Annotate with the native toolbar, return key, offline banner (toggle Tailscale on the phone) | dshfiles | Each produces a before/after evidence folder                              |
| T7 | Skill `verify-phone` (or a section of `verify-dsh`): when to use it, setup, safety rules, cleanup (`adb usb`)                 | dshfiles        | Skill loads; `features:check` unaffected                                  |
| T8 | Optional: Playwright `_android` scripted contexts for repeatable journeys                                                    | dshfiles        | One journey runs end to end on the device                                 |
| T9 | iPhone: Safari Web Inspector / `ios-webkit-debug-proxy` attach to the DSH Home Screen app; same journeys where possible        | dshfiles        | Attach and capture on the owner's iPhone                                  |

## Decisions (2026-11-16)

1. Set up later, when a phone bug needs it.
2. The agent may drive the phone (taps, swipes, lock/wake via `adb`): that is what reproduces the lock/resume and
   gesture bugs and runs journeys unattended; a PIN unlock stays with the owner.
3. Add the Tailscale ACL (T4), at setup time.
4. Both Android and iPhone (T9).
