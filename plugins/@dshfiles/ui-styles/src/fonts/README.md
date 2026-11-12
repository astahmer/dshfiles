# Vendored fonts

| File                                 | Family     | Source                                  | Licence                                                |
| ------------------------------------ | ---------- | --------------------------------------- | ------------------------------------------------------ |
| `geist-latin-wght-normal.woff2`      | Geist      | `@fontsource-variable/geist@5.3.0`      | SIL OFL 1.1 ([OFL-Geist.txt](OFL-Geist.txt))           |
| `geist-mono-latin-wght-normal.woff2` | Geist Mono | `@fontsource-variable/geist-mono@5.3.0` | SIL OFL 1.1 ([OFL-Geist-Mono.txt](OFL-Geist-Mono.txt)) |

Upstream: [vercel/geist-font](https://github.com/vercel/geist-font), packaged by [Fontsource](https://fontsource.org).
Copied unmodified from `files/` in the npm tarballs on 2026-11-09:

```text
sha256 19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1  geist-latin-wght-normal.woff2
sha256 684ad5b531f81d43c1e8c7038262d5db7cdc1f68006e04d6c7769efa8d33c8cc  geist-mono-latin-wght-normal.woff2
```

**Why vendored, not a dependency:** two static files that never change between releases; a new dependency in
`ui-styles` re-hashed the `@deepseek-ai/dsh` peer set across ~700 lockfile lines, and dshx inlines client assets
anyway, so the package would only be a copy source. To update: `npm pack @fontsource-variable/geist@<v>`, copy the
`latin-wght-normal` file and `LICENSE`, refresh the hashes above.

Only the latin variable (normal) faces ship. Other scripts use the system stack that follows `Geist` in
[`../fonts.css`](../fonts.css); italics are synthesised by the browser.
