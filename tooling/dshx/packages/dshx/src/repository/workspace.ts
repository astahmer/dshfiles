import { existsSync, globSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'

/**
 * Workspace packages of a dshx repository and the cycles between them. Kept free of relative imports so the repository
 * scripts can load this source file under Node type stripping, before dshx is built; callers hand in their own JSON
 * decode boundary.
 */

type DecodeJson = <Schema extends z.ZodType>(schema: Schema, text: string) => z.output<Schema>

const dependencyFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const
const dependencyMapSchema = z.record(z.string(), z.string()).optional()
const manifestSchema = z.looseObject({
  name: z.string().optional(),
  dependencies: dependencyMapSchema,
  devDependencies: dependencyMapSchema,
  peerDependencies: dependencyMapSchema,
  optionalDependencies: dependencyMapSchema,
})
const workspaceFileSchema = z.looseObject({ packages: z.array(z.string()).default([]) })

export interface WorkspacePackage {
  readonly name: string
  /** Absolute path of the package folder. */
  readonly directory: string
  readonly manifest: z.output<typeof manifestSchema>
}

export class RepositoryWorkspace {
  /** The nearest folder holding `pnpm-workspace.yaml`, else the nearest one holding `package.json`. */
  static root(cwd: string): string {
    let packageRoot: string | undefined
    for (let directory = resolve(cwd); ; directory = dirname(directory)) {
      if (existsSync(join(directory, 'pnpm-workspace.yaml'))) return directory
      if (packageRoot === undefined && existsSync(join(directory, 'package.json'))) packageRoot = directory
      if (existsSync(join(directory, '.jj')) || existsSync(join(directory, '.git')) || dirname(directory) === directory) return packageRoot ?? resolve(cwd)
    }
  }

  /** The `pnpm-workspace.yaml` packages, or the root package alone in a single-package repository. */
  static packages(input: { readonly root: string; readonly decodeJson: DecodeJson }): readonly WorkspacePackage[] {
    const workspacePath = join(input.root, 'pnpm-workspace.yaml')
    const patterns = existsSync(workspacePath) ? workspaceFileSchema.parse(parse(readFileSync(workspacePath, 'utf8')) ?? {}).packages : ['.']
    const excluded = new Set(
      globSync(
        patterns.filter(pattern => pattern.startsWith('!')).map(pattern => pattern.slice(1)),
        { cwd: input.root },
      ),
    )
    const directories = globSync(
      patterns.filter(pattern => !pattern.startsWith('!')),
      { cwd: input.root },
    ).filter(path => !excluded.has(path) && !path.split('/').includes('node_modules'))
    const packages = new Map<string, WorkspacePackage>()
    for (const path of directories) {
      const directory = resolve(input.root, path)
      const manifestPath = join(directory, 'package.json')
      if (!statSync(directory).isDirectory() || !existsSync(manifestPath)) continue
      const manifest = input.decodeJson(manifestSchema, readFileSync(manifestPath, 'utf8'))
      if (manifest.name !== undefined) packages.set(manifest.name, { name: manifest.name, directory, manifest })
    }
    return [...packages.values()].sort((left, right) => left.name.localeCompare(right.name))
  }

  /** Workspace packages this one names in any dependency field, peer and optional dependencies included. */
  static dependencies(workspacePackage: WorkspacePackage, packages: readonly WorkspacePackage[]): readonly string[] {
    const names = new Set(packages.map(item => item.name))
    return [...new Set(dependencyFields.flatMap(field => Object.keys(workspacePackage.manifest[field] ?? {})))].filter(name => names.has(name))
  }

  /**
   * Strongly connected components with more than one package, or a package that depends on itself. Turbo orders builds
   * by dependencies and devDependencies only, so a cycle that closes through a peer dependency builds against whatever
   * stale `dist/` the other side left.
   */
  static cycles(packages: readonly WorkspacePackage[]): readonly (readonly string[])[] {
    const edges = new Map(packages.map(item => [item.name, RepositoryWorkspace.dependencies(item, packages)]))
    let counter = 0
    const index = new Map<string, number>()
    const low = new Map<string, number>()
    const stack: string[] = []
    const onStack = new Set<string>()
    const cycles: string[][] = []
    const lowOf = (name: string): number => low.get(name) ?? 0
    const visit = (name: string): void => {
      index.set(name, counter)
      low.set(name, counter)
      counter += 1
      stack.push(name)
      onStack.add(name)
      for (const next of edges.get(name) ?? []) {
        if (!index.has(next)) {
          visit(next)
          low.set(name, Math.min(lowOf(name), lowOf(next)))
        } else if (onStack.has(next)) low.set(name, Math.min(lowOf(name), index.get(next) ?? 0))
      }
      if (lowOf(name) !== index.get(name)) return
      const component: string[] = []
      let member: string | undefined
      do {
        member = stack.pop()
        if (member === undefined) break
        onStack.delete(member)
        component.push(member)
      } while (member !== name)
      if (component.length > 1 || (edges.get(name) ?? []).includes(name)) cycles.push(component.sort())
    }
    for (const name of [...edges.keys()].sort()) if (!index.has(name)) visit(name)
    return cycles
  }
}
