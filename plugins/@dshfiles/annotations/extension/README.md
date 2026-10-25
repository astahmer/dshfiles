# DSH annotations browser extension

The capture path for pages DSH does not own. A plugin cannot read a cross-origin
page, so the page itself has to cooperate; this MV3 extension is that cooperation.

## Install

1. Open `chrome://extensions`, enable **Developer mode**, and drag this
   `extension/` directory onto the page (or choose **Load unpacked**). Chrome has
   no API for a page or another extension to install unpacked code, so this one
   step stays manual by design.
2. In DSH, open the composer's crosshair panel, expand **Browser extension**, and
   click **Pair extension**.
3. In this popup, click **Pair with DSH**. The extension pulls its token from DSH
   once, within that two-minute window — nothing to copy or paste.

Pairing is single use and expires on its own. If it lapses, click **Pair
extension** again in DSH. A token can still be pasted by hand under _Paste a
token instead_.

The extension id is fixed by the public `key` committed in
`manifest.json` — `chrome-extension://onffhgfpkepofnhfaklomllipdpgmmbb` — so it
is the same on every machine and the Host trusts that exact origin by default.
Nothing per-machine to configure, and loading unpacked from any path keeps the
id.

`DSH_ANNOTATIONS_EXTENSION_ORIGINS` exists only for a locally modified build
with a different key: set it to a comma-separated origin list and that replaces
the pinned default.

## Use

Press the extension action, then **Annotate this tab**, then click the element
and type the note in the browser prompt. The annotation is posted to the DSH
Host, which stores it **unassigned**; DSH then asks which thread owns it.

## Permissions

- `activeTab` — granted per tab only when you press the action, so there is no
  broad host access and no `<all_urls>`.
- `scripting` — injects the picker into that active tab.
- `storage` — keeps the ingest URL and the token locally.

## Security notes

- The bearer token is the real gate. The Host also requires a loopback peer, an
  exact `chrome-extension://<id>` origin, a 64 KB body cap, a schema check and a
  per-origin rate limit.
- Pairing only answers while the user has opened the window in DSH, from the same
  pinned origin, and it hands the token over exactly once.
- Captures refuse form values, `contenteditable` contents and any
  `[data-private]` subtree, and they strip the URL query and hash.
- `chrome://` pages, the Web Store and other extensions' pages cannot be
  scripted by any extension, so they are out of scope.
