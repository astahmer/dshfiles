# Select installed verification binaries

Scratch verification normally finds `dsh` on PATH and uses Playwright's bundled
Chromium. Two optional environment variables let a checkout use an existing
installation instead:

| Variable | Selected executable | Used by |
| --- | --- | --- |
| `DSHX_DSH_EXECUTABLE` | Installed stock DSH CLI | Composition dumps, Host/client boot checks, E2E Hosts and `dshx dev up` |
| `DSHX_CHROMIUM_EXECUTABLE` | Installed Chrome/Chromium | Chromium client boot checks, the Chromium E2E project and scratch persistent browsers |

Set each variable to an **absolute executable file**, not a command name,
`~/...`, directory or command with arguments. An invalid override fails closed;
it never silently falls back. Leave the variables unset to retain existing
defaults. Explicit boot-check `executable` API options retain precedence and
command-name support. Firefox and WebKit checks are unchanged.

Choose the installed stock DSH executable, not a personal launcher that rewrites
HOME or DSH_HOME. The selected binary is trusted local configuration; this is
not a sandbox for an arbitrary executable. A Node-based CLI still needs a
compatible Node on PATH. No core or browser is downloaded or upgraded by these
options, and an installed browser still needs a successful live compatibility
check against the checkout's Playwright version.

The same DSH executable is used for a composition check and its Host startup.
An E2E fixture pins that selection through its restart and prewarm lifecycle,
and composition caches distinguish selected executable paths. The existing
isolated HOME/DSH_HOME, private browser profile, headless settings and owned
process cleanup remain in effect.

Turbo includes both variables in its environment/cache identity. Changing the
contents of an executable at the same path is not a binary-version checksum;
rerun verification after replacing an installation in place.
