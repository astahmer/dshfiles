import { NodeServices } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ProjectIcons } from './project-icons.js'

const platform = NodeServices.layer

const iconsLayer = ProjectIcons.layer.pipe(Layer.provide(platform))

const scratchProject = (files: Readonly<Record<string, string>>) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const root = mkdtempSync(join(tmpdir(), 'dsh-project-icons-'))
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true })
        writeFileSync(join(root, path), content)
      }
      return root
    }),
    root => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
  )

const iconsOf = Effect.gen(function* () {
  const services = yield* Layer.build(iconsLayer)
  return Context.get(services, ProjectIcons)
})

describe('project icons on the Host', () => {
  it.live('answers a repeated read from the Host cache instead of the checkout', () =>
    Effect.gen(function* () {
      const root = yield* scratchProject({ 'public/favicon.svg': '<svg id="first"/>' })
      const icons = yield* iconsOf
      const first = yield* icons.read({ path: root, title: 'project' })
      expect(first).toMatchObject({ kind: 'image', source: 'public/favicon.svg' })

      writeFileSync(join(root, 'public/favicon.svg'), '<svg id="second"/>')
      expect(yield* icons.read({ path: root, title: 'project' })).toEqual(first)
    }),
  )

  it.live('keeps the miss path and re-checks a project that gained an icon on the next Host', () =>
    Effect.gen(function* () {
      const root = yield* scratchProject({})
      const icons = yield* iconsOf
      expect(yield* icons.read({ path: root, title: 'deepseek harness' })).toMatchObject({ kind: 'monogram', value: 'DH' })

      writeFileSync(join(root, 'favicon.ico'), 'icon-bytes')
      expect(yield* icons.read({ path: root, title: 'deepseek harness' })).toMatchObject({ kind: 'monogram' })

      const nextHost = yield* iconsOf
      expect(yield* nextHost.read({ path: root, title: 'deepseek harness' })).toMatchObject({ kind: 'image', source: 'favicon.ico' })
    }),
  )
})
