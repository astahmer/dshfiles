import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalBundleModel } from '../src/project/local-bundles.js'
import { ScratchActivation } from '../src/scratch/lifecycle.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const pluginsRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'dshx-plugin-rows-'))
  roots.push(root)
  return root
}

const addPlugin = async (root: string, folder: string, patch: string | undefined): Promise<void> => {
  const projectRoot = join(root, folder)
  await mkdir(projectRoot, { recursive: true })
  await writeFile(join(projectRoot, 'package.json'), JSON.stringify({ name: `@fixture/${folder}`, dsh: {} }))
  if (patch !== undefined) await writeFile(join(projectRoot, 'cordis.patch.yml'), patch)
}

describe('LocalBundleModel.listLocalBootBundles', () => {
  it('tells a bundle that owns Loader rows from a preset child that declares none', async () => {
    const root = await pluginsRoot()
    await addPlugin(root, 'owns-rows', "# A patch row.\n- insert:\n    - id: owns-rows\n      name: '@fixture/owns-rows'\n")
    await addPlugin(root, 'preset-child', '# The model-facing tool is a child of an agent preset.\n[]\n')
    await addPlugin(root, 'no-patch', undefined)

    const bundles = await LocalBundleModel.listLocalBootBundles({ pluginsRoot: root })

    expect(bundles.map(bundle => [bundle.packageId, bundle.composesLoaderRows])).toEqual([
      ['@fixture/no-patch', false],
      ['@fixture/owns-rows', true],
      ['@fixture/preset-child', false],
    ])
  })
})

describe('ScratchActivation.expectations', () => {
  it('expects an active row only for bundles that own one, keeping preset children under test', () => {
    expect(
      ScratchActivation.expectations({ bundles: ['@fixture/thread-sidebar', '@dshfiles/tool-ask-user'], expectedEntries: ['@fixture/thread-sidebar'] }),
    ).toEqual({
      expectedEntries: ['@fixture/thread-sidebar'],
      composedByAnotherRow: ['@dshfiles/tool-ask-user'],
    })
  })

  it('assumes every bundle owns a row on a state file written before the field existed', () => {
    expect(ScratchActivation.expectations({ bundles: ['@fixture/thread-sidebar', '@dshfiles/tool-ask-user'] })).toEqual({
      expectedEntries: ['@fixture/thread-sidebar', '@dshfiles/tool-ask-user'],
      composedByAnotherRow: [],
    })
  })
})
