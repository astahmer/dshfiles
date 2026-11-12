/** Branding the installed app shows; every field has a default in the Host entry. */
export interface Branding {
  readonly title: string
  readonly shortName: string
  readonly backgroundColor: string
}

/** One manifest icon entry the launcher reads. */
export interface ManifestIcon {
  readonly src: string
  readonly sizes: string
  readonly type: string
  readonly purpose: string
}

/**
 * The same shell metadata the stock manifest declares (the Web app is served at
 * the origin root, and Chrome's Android install still expects a fullscreen or
 * standalone display), plus raster icons the phone launchers can use.
 */
export const manifestIcons: readonly ManifestIcon[] = [
  { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
]

/** The install document the browser fetches. */
export interface AppManifest {
  readonly name: string
  readonly short_name: string
  readonly id: string
  readonly start_url: string
  readonly scope: string
  readonly display: string
  readonly background_color: string
  readonly icons: readonly ManifestIcon[]
}

/**
 * One manifest document. `theme_color` stays out on purpose: the app already
 * owns `meta[name="theme-color"]` and rewrites it from the resolved theme, so a
 * static manifest value would fight the live one.
 */
export const buildManifest = (branding: Branding): AppManifest => ({
  name: branding.title,
  short_name: branding.shortName,
  id: '/',
  start_url: '/',
  scope: '/',
  display: 'fullscreen',
  background_color: branding.backgroundColor,
  icons: manifestIcons,
})
