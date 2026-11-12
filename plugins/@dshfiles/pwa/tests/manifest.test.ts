import { describe, expect, test } from 'vitest'
import { buildManifest, manifestIcons } from '../src/manifest.ts'

const branding = { title: 'DeepSeek Harness', shortName: 'DSH', backgroundColor: '#0f1115' }

describe('installed app manifest', () => {
  test('keeps the shell metadata the stock manifest declares', () => {
    const manifest = buildManifest(branding)
    expect(manifest).toMatchObject({
      name: 'DeepSeek Harness',
      short_name: 'DSH',
      id: '/',
      start_url: '/',
      scope: '/',
      display: 'fullscreen',
      background_color: '#0f1115',
    })
  })

  test('offers the raster sizes an Android launcher and maskable icon require', () => {
    expect(manifestIcons).toEqual([
      { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ])
  })

  test('leaves theme_color to the live meta tag the theme presenter owns', () => {
    expect(buildManifest(branding)).not.toHaveProperty('theme_color')
  })

  test('uses the configured branding for the installed app name and splash', () => {
    const manifest = buildManifest({ title: 'Custom Harness', shortName: 'CH', backgroundColor: '#123456' })
    expect(manifest).toMatchObject({ name: 'Custom Harness', short_name: 'CH', background_color: '#123456' })
  })
})
