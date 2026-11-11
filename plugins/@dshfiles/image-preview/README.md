# `@dshfiles/image-preview`

What `@dshfiles/deliverables` and `@dshfiles/diffs-review` share to show a changed image instead of dropping it as a
binary file:

- `ImagePreview.typeOf(path)`: the media type of a previewable extension (`png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`, `avif`),
  or `undefined` for anything else.
- `ImagePreview.maxBytes`: the 8 MB cap a preview route reads up to; above it the route answers 413.
- `ImagePreview.response({ bytes, type })`: the bytes with an explicit `Content-Type`, `nosniff`, `no-store` and a
  `sandbox` content security policy, so an SVG opened directly runs no script.
- `ImagePreview.refusal({ status, reason })` and `ImagePreview.refusalOf(status)`: the refusals a route answers (403
  outside, 404 missing, 413 too large, 415 not an image) and how a viewer reads them back.
- `@dshfiles/image-preview/react` `useImagePreview(url)`: fetches a route into a blob URL revoked on unmount, with a
  retry for errors.

Each owner keeps its own route and its own path guard: deliverables serves a file listed in a DSH change summary,
diffs-review serves a file at a jj or git revision. This library holds only what both must answer the same way.

`build` emits ordinary ESM into `dist/`; `test` builds, runs the unit tests and loads the built package with plain Node.
