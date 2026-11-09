import { NodeServices } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Path } from 'effect'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ProjectIcon } from './project-icon.js'

const platform = NodeServices.layer

const scratchProject = (files: Readonly<Record<string, string>>) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const root = mkdtempSync(join(tmpdir(), 'dsh-project-icon-'))
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true })
        writeFileSync(join(root, path), content)
      }
      return root
    }),
    root => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
  )

const resolveIn = (root: string, title = 'my project') =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    return yield* ProjectIcon.resolve({ fs, path, workspaceRoot: root, title })
  })

describe('project icons', () => {
  it.effect('prefers the iconPath declared in dsh.project.json', () =>
    Effect.gen(function* () {
      const root = yield* scratchProject({
        'dsh.project.json': '{"iconPath":"brand/mark.svg"}',
        'brand/mark.svg': '<svg/>',
        'assets/icon.svg': '<svg id="other"/>',
      })
      const icon = yield* resolveIn(root)
      expect(icon).toMatchObject({ kind: 'image', source: 'brand/mark.svg', mediaType: 'image/svg+xml' })
      expect(icon.value.startsWith('data:image/svg+xml;base64,')).toBe(true)
    }).pipe(Effect.provide(platform)),
  )

  it.effect('falls back to the first candidate the checkout holds', () =>
    Effect.gen(function* () {
      const root = yield* scratchProject({ 'public/favicon.png': 'png-bytes' })
      expect(yield* resolveIn(root)).toMatchObject({ kind: 'image', source: 'public/favicon.png', mediaType: 'image/png' })
    }).pipe(Effect.provide(platform)),
  )

  it.effect('uses a monogram when no icon file exists and ignores an unsupported declaration', () =>
    Effect.gen(function* () {
      const root = yield* scratchProject({ 'dsh.project.json': '{"iconPath":"logo.txt"}', 'logo.txt': 'not an image' })
      expect(yield* resolveIn(root, 'DeepSeek Harness')).toMatchObject({ kind: 'monogram', value: 'DH', source: 'monogram' })
    }).pipe(Effect.provide(platform)),
  )

  it.effect('ignores an invalid project file instead of failing the read', () =>
    Effect.gen(function* () {
      const root = yield* scratchProject({ 'dsh.project.json': 'not json' })
      expect(yield* resolveIn(root, 'solo')).toMatchObject({ kind: 'monogram', value: 'SO' })
    }).pipe(Effect.provide(platform)),
  )

  it.effect('caches a hit and rechecks a miss sooner', () =>
    Effect.gen(function* () {
      const root = yield* scratchProject({})
      const icons = yield* ProjectIcon.cache({ fs: yield* FileSystem.FileSystem, path: yield* Path.Path })
      const first = yield* icons.read({ workspaceRoot: root, title: 'project', now: 0 })
      const cached = yield* icons.read({ workspaceRoot: root, title: 'project', now: 30_000 })
      const rechecked = yield* icons.read({ workspaceRoot: root, title: 'project', now: 90_000 })
      expect(first).toEqual(cached)
      expect(rechecked).toEqual(first)
    }).pipe(Effect.provide(platform)),
  )
})

describe('monogram', () => {
  it.effect('derives one or two initials from the project name', () =>
    Effect.sync(() => {
      const titles = ['my project', 'solo', 'a-b_c.d', '  ', 'École Normale']
      expect(titles.map(title => ProjectIcon.monogram(title))).toEqual(['MP', 'SO', 'AB', '?', 'ÉN'])
    }),
  )
})
