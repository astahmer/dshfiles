import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import type { Plugin } from 'vite'
import { DshxError } from '../../diagnostics.js'
import { containsPrivateDshxImport } from '../private-imports.js'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const dshPackageName = (specifier: string): string | undefined => {
  const [scope, name] = specifier.split('/')
  if (scope !== '@deepseek-ai' || name === undefined) return undefined
  return scope + '/' + name
}

/** Lazy DSHX runtime integrations load only when the composition opts into them. */
const HOST_RUNTIME_OPTIONAL_IMPORTS = new Set(['@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-cordis-host-runner', '@deepseek-ai/dsh-tool-cordis'])

/** Keep external DSH Host imports on the Host installation's module identity. */
export function hostPeerDependencyPlugin(root: string): Plugin {
  const packageFile = resolve(root, 'package.json')
  let declaredPeers = new Set<string>()
  return {
    name: 'dshx-host-peer-dependencies',
    async buildStart() {
      let manifest: unknown
      try {
        manifest = JSON.parse(await readFile(packageFile, 'utf8'))
      } catch (cause) {
        throw new DshxError('DSHX4005', 'Cannot inspect Host package peerDependencies.', {
          cause,
          file: packageFile,
          hint: 'Keep a valid package.json at the project root so DSHX can check external Host imports.',
        })
      }
      if (!isRecord(manifest)) {
        throw new DshxError('DSHX4005', 'Host package.json must contain an object.', {
          file: packageFile,
        })
      }
      const peers = isRecord(manifest.peerDependencies) ? manifest.peerDependencies : {}
      declaredPeers = new Set(Object.keys(peers))
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const entry = Object.values(bundle).find(output => output.type === 'chunk' && output.isEntry)
        if (entry === undefined || entry.type !== 'chunk') return
        const missing = new Set<string>()
        const requiredImports = [
          ...entry.imports,
          ...entry.dynamicImports.filter(specifier => {
            const packageName = dshPackageName(specifier)
            return packageName === undefined || !HOST_RUNTIME_OPTIONAL_IMPORTS.has(packageName)
          }),
        ]
        for (const specifier of requiredImports) {
          const packageName = dshPackageName(specifier)
          if (packageName !== undefined && !declaredPeers.has(packageName)) missing.add(packageName)
        }
        const missingPackages = [...missing].sort()
        if (missingPackages.length === 0) return
        throw new DshxError('DSHX4005', 'Host artifact imports @deepseek-ai packages missing from peerDependencies: ' + missingPackages.join(', ') + '.', {
          file: packageFile,
          hint: 'Declare each external DSH package as a peer so linked Host bundles resolve the Host installation copy. Mark optional runtime integrations in peerDependenciesMeta.',
        })
      },
    },
  }
}

/** Keep package imports and Node protocols available for the Host runtime. */
export function isHostExternal(source: string): boolean {
  if (source.startsWith('\0') || source.startsWith('.') || isAbsolute(source)) return false
  if (/^[A-Za-z]:[/\\]/.test(source)) return false
  if (source === 'create-dshx/capabilities' || source === 'create-dshx/runtime-capabilities') return false
  return true
}

/** Enforce the stable single-file Host artifact surface. */
export function singleHostChunkPlugin(): Plugin {
  return {
    name: 'dshx-single-host-chunk',
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const chunks = Object.values(bundle).filter(output => output.type === 'chunk')
        const assets = Object.values(bundle).filter(output => output.type === 'asset')
        if (chunks.length !== 1 || chunks[0]?.isEntry !== true || chunks[0].fileName !== 'index.js') {
          throw new DshxError('DSHX1302', 'A DSH Host build must emit exactly one index.js entry chunk.')
        }
        const chunk = chunks[0]
        const requiredExports = ['Config', 'apply', 'inject', 'name']
        const missingExports = requiredExports.filter(name => !chunk.exports.includes(name))
        if (missingExports.length > 0 || !/\bexport\s*\{/.test(chunk.code)) {
          throw new DshxError('DSHX1302', 'A Vite plugin corrupted the DSH Host module protocol.', {
            hint: `Preserve the ${requiredExports.join(', ')} named exports; avoid replacing the final chunk in renderChunk/generateBundle.`,
          })
        }
        if (containsPrivateDshxImport(chunk.code)) {
          throw new DshxError('DSHX1302', 'The DSH Host artifact retained a private DSHX runtime import.')
        }
        const unexpectedAssets = assets.filter(asset => !asset.fileName.endsWith('.js.map'))
        if (unexpectedAssets.length > 0) {
          throw new DshxError('DSHX1303', `A DSH Host build emitted unsupported assets: ${unexpectedAssets.map(asset => asset.fileName).join(', ')}.`)
        }
      },
    },
  }
}
