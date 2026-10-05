# Sidebar Commands

A client-only `/goto` slash command. Its popup lists every panel registered in
`sidebar.panellist` that also has a `main` occupant, then the 20 most recently
updated sessions, and opens the row you pick through `ctx.layout.selectPanel`
or `ctx.uiWorkspace.openSession`.

Panels come from the live slot ledger, so a new owned panel shows up without
editing this plugin. Blank, subagent and archived sessions are left out; the
archive set is the registry-global `ctx.workspaces.list` snapshot the session
browser reads. A navigation that fails, for example because the panel was
unregistered after the popup opened, surfaces in the popup shell and leaves the
current view in place.

The command only navigates: it never creates, archives or submits anything.

## Port notes

Ported from the 0.1-era `/go` plugin. It is named `goto` because DSH ships
`/goal`, and typing `/go` highlighted `/goal` first, so Enter ran the wrong
command. The palette entry and route navigation from the BB original remain
platform boundaries: DSH's command palette has no plugin registration seam and
DSH has no route paths.
