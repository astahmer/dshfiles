# @dshfiles/shortcuts

Capture-phase keyboard shortcut registry for DSH plugins. Registered chords are claimed before browser defaults and conflicting shortcut handlers can coordinate through the shared service.

A chord is claimed only where it cannot type anything and nothing else already answered it. The focused element decides the region the same way the Host adapter does: a terminal (`.xterm`) comes first, then a text field, then the page. Commands claimed through the `Command` registry keep their keys everywhere, except while a terminal has focus, where `allowInTerminal: false` leaves the key to the shell (`Ctrl+J` is a line feed).

This is an owned DSH bundle. Run `pnpm build`, `pnpm test`, and `pnpm typecheck` from this package.
