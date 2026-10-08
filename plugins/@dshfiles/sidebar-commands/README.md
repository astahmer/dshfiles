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

When @dshfiles/thread-sidebar is loaded (it acknowledges a probe of the
cancelable `dshfiles:command-palette` window event), the popup leads with
**Open command palette** and **Search threads**. That palette lists every
sidebar destination dynamically, which covers the BB Cmd-Shift-P page entries
and the Customize sidebar entry.

The command only navigates: it never creates, archives or submits anything.

## Port notes

Ported from the 0.1-era `/go` plugin. It is named `goto` because DSH ships
`/goal`, and typing `/go` highlighted `/goal` first, so Enter ran the wrong
command. DSH has no native command palette or route paths; the palette lives in
@dshfiles/thread-sidebar instead. BB's Remote access entry has no DSH
counterpart.
