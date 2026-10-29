import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withSpan } from '@dshfiles/dshx/tracing'
import { MAX_BUNDLES, MAX_MAP_BYTES, MAX_TOTAL_MAP_BYTES } from './limits.js'
import { type RawSourceMap, SourceMaps } from './sourcemap.js'
import type { SourceMatch } from './schema.js'

interface FileFingerprint {
  readonly mtimeMs: number
  readonly size: number
}

interface CachedText extends FileFingerprint {
  readonly text: string
}

interface CachedMap extends FileFingerprint {
  readonly map: RawSourceMap
}

export interface Bundle {
  readonly name: string
  readonly mapPath: string
  readonly codePath: string
}

export interface SourceResolver {
  resolve(names: readonly string[]): Promise<SourceMatch[]>
  resolveText(texts: readonly string[]): Promise<SourceMatch[]>
  bundles(): Promise<Bundle[]>
}

const fingerprintOf = async (path: string): Promise<FileFingerprint | undefined> => {
  try {
    const info = await stat(path)
    return { mtimeMs: info.mtimeMs, size: info.size }
  } catch {
    return undefined
  }
}

/**
 * The Host entry lives at `<repo>/plugins/@dshfiles/<pkg>/dist/index.js`, so its own
 * module URL names the sibling bundle root exactly — no guess about the process cwd.
 * A published package falls back to the env seam and then to the workspace walk.
 */
const rootFromModuleUrl = (moduleUrl: string | undefined): string[] => {
  if (moduleUrl === undefined) return []
  try {
    const own = fileURLToPath(moduleUrl)
    const sibling = dirname(dirname(dirname(own)))
    return /[\\/]plugins[\\/]@dshfiles$/.test(sibling) ? [sibling] : []
  } catch {
    return []
  }
}

export class BundleSources {
  static discoverPluginRoots = async ({
    start,
    env,
    moduleUrl,
  }: {
    readonly start: string
    readonly env: NodeJS.ProcessEnv
    readonly moduleUrl?: string
  }): Promise<string[]> => {
    const fromModule = rootFromModuleUrl(moduleUrl)
    if (fromModule.length > 0) return fromModule
    const fromEnv = env.DSHFILES_DIR
    if (fromEnv !== undefined && fromEnv.length > 0) return [join(fromEnv, 'plugins', '@dshfiles')]
    let current = start
    for (let depth = 0; depth < 8; depth += 1) {
      const workspace = join(current, 'pnpm-workspace.yaml')
      const fingerprint = await fingerprintOf(workspace)
      if (fingerprint !== undefined) {
        try {
          const text = await readFile(workspace, 'utf8')
          if (text.includes('plugins')) return [join(current, 'plugins', '@dshfiles')]
        } catch {
          return []
        }
      }
      const parent = dirname(current)
      if (parent === current) return []
      current = parent
    }
    return []
  }

  static listBundles = async ({ root, limit = MAX_BUNDLES }: { readonly root: string; readonly limit?: number }): Promise<Bundle[]> => {
    let entries: string[]
    try {
      entries = await readdir(root)
    } catch {
      return []
    }
    const bundles: Bundle[] = []
    for (const entry of entries.sort().slice(0, limit)) {
      const codePath = join(root, entry, 'dist', 'client.js')
      const fingerprint = await fingerprintOf(codePath)
      if (fingerprint === undefined) continue
      bundles.push({ name: entry, codePath, mapPath: `${codePath}.map` })
    }
    return bundles
  }

  /**
   * CSS-module class names from a stored selector, unescaped. A bare utility class
   * ("cta", "row") appears in too many bundles to be evidence; a module name carries
   * its hash and an underscore.
   */
  static classCandidates = (selector: string): string[] => {
    const matches = selector.match(/\.[^\s>]+/g) ?? []
    const names = matches.map(match => match.slice(1).replaceAll('\\', '')).filter(name => name.length >= 4 && name.includes('_'))
    return Array.from(new Set(names)).slice(0, 6)
  }

  static createSourceResolver = ({
    roots,
    maxBundles = MAX_BUNDLES,
    maxMapBytes = MAX_MAP_BYTES,
    maxTotalMapBytes = MAX_TOTAL_MAP_BYTES,
  }: {
    readonly roots: readonly string[]
    readonly maxBundles?: number
    readonly maxMapBytes?: number
    readonly maxTotalMapBytes?: number
  }): SourceResolver => {
    const textCache = new Map<string, CachedText>()
    const mapCache = new Map<string, CachedMap>()
    let bundleCache: { readonly key: string; readonly bundles: Bundle[] } | undefined

    const bundles = async (): Promise<Bundle[]> => {
      const key = roots.join('|')
      if (bundleCache !== undefined && bundleCache.key === key) return bundleCache.bundles
      const collected: Bundle[] = []
      for (const root of roots) {
        collected.push(...(await BundleSources.listBundles({ root, limit: maxBundles })))
      }
      bundleCache = { key, bundles: collected }
      return collected
    }

    const codeOf = async (bundle: Bundle): Promise<string | undefined> => {
      const fingerprint = await fingerprintOf(bundle.codePath)
      if (fingerprint === undefined) return undefined
      const cached = textCache.get(bundle.codePath)
      if (cached !== undefined && cached.mtimeMs === fingerprint.mtimeMs && cached.size === fingerprint.size) return cached.text
      try {
        const text = await readFile(bundle.codePath, 'utf8')
        textCache.set(bundle.codePath, { ...fingerprint, text })
        return text
      } catch {
        return undefined
      }
    }

    const mapOf = async (bundle: Bundle): Promise<RawSourceMap | undefined> => {
      const fingerprint = await fingerprintOf(bundle.mapPath)
      if (fingerprint === undefined || fingerprint.size > maxMapBytes) return undefined
      const cached = mapCache.get(bundle.mapPath)
      if (cached !== undefined && cached.mtimeMs === fingerprint.mtimeMs && cached.size === fingerprint.size) return cached.map
      try {
        const raw = await readFile(bundle.mapPath, 'utf8')
        const map = JSON.parse(raw) as RawSourceMap
        if (typeof map.mappings !== 'string' || !Array.isArray(map.sources)) return undefined
        mapCache.set(bundle.mapPath, { ...fingerprint, map })
        return map
      } catch {
        return undefined
      }
    }

    const absoluteOf = ({ bundle, source }: { readonly bundle: Bundle; readonly source: string }): string =>
      source.startsWith('/') ? source : join(dirname(bundle.mapPath), source)

    /** A dependency's source is never the answer: the plugin that renders the element is. */
    const ownedSource = (absolute: string): boolean => !absolute.split(/[\\/]/).includes('node_modules')

    const matchFor = async ({
      name,
      bundle,
      confidence,
    }: {
      readonly name: string
      readonly bundle: Bundle
      readonly confidence: 'map' | 'text'
    }): Promise<SourceMatch | undefined> => {
      const map = await mapOf(bundle)
      if (map === undefined) return undefined
      let position = undefined as ReturnType<typeof SourceMaps.originalPositionFor>
      if (confidence === 'map') {
        const code = await codeOf(bundle)
        if (code === undefined) return undefined
        const generated = SourceMaps.findGeneratedPosition({ text: code, needle: name })
        if (generated === undefined) return undefined
        position = SourceMaps.originalPositionFor({ map, position: generated })
      } else {
        position = SourceMaps.sourceContentPosition({ map, needle: name })
      }
      if (position === undefined) return undefined
      const absolute = absoluteOf({ bundle, source: position.source })
      if (!ownedSource(absolute)) return undefined
      return {
        name,
        file: relative(process.cwd(), absolute),
        line: position.line,
        column: position.column,
        confidence,
      }
    }

    const scan = async ({ needles, confidence }: { readonly needles: readonly string[]; readonly confidence: 'map' | 'text' }): Promise<SourceMatch[]> => {
      const available = await bundles()
      const found: SourceMatch[] = []
      let scannedBytes = 0
      for (const name of needles) {
        if (found.some(match => match.name === name)) continue
        for (const bundle of available) {
          if (scannedBytes > maxTotalMapBytes) return found
          const map = await mapOf(bundle)
          if (map === undefined) continue
          scannedBytes += JSON.stringify(map).length
          const match = await matchFor({ name, bundle, confidence })
          if (match !== undefined) {
            found.push(match)
            break
          }
        }
      }
      return found
    }

    return {
      resolve: names => withSpan('annotations resolve source', () => scan({ needles: names, confidence: 'map' })),
      resolveText: texts => withSpan('annotations resolve text', () => scan({ needles: texts, confidence: 'text' })),
      bundles,
    }
  }
}
