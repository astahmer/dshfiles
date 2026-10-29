import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import * as cordis from '@deepseek-ai/cordis'

interface ClientModule {
  readonly factory: (require: (id: string) => unknown) => unknown
}

/** Load native lazy client factories without mounting the application. Node-only test utility. */
export function createClientModuleLoader(): (id: string) => unknown {
  const modules = new Map<string, unknown>()
  const fallback = createRequire(import.meta.url)
  const load: (id: string, importer?: string) => unknown = (id, importer = import.meta.url) => {
    if (id === '@deepseek-ai/cordis') return cordis
    // The browser shares these platform modules. Resolve one matching pair from
    // the test project rather than a provider's unrelated hoisted dependencies.
    if (id === 'react' || id.startsWith('react/') || id === 'react-dom' || id.startsWith('react-dom/')) return fallback(id)
    const require = createRequire(importer)
    let entry: string
    try {
      entry = require.resolve(id)
    } catch {
      entry = fallback.resolve(id)
    }
    // This harness checks registrations, not CSS rendering or asset loading.
    if (entry.endsWith('.css')) return {}
    if (modules.has(entry)) return modules.get(entry)
    const source = readFileSync(entry, 'utf8')
    if (!source.includes('window.__ModuleLoader__.load(')) return require(entry)
    let module: ClientModule | undefined
    runInNewContext(
      source,
      {
        window: {
          __ModuleLoader__: {
            load: (value: ClientModule) => {
              module = value
            },
          },
        },
        console,
        AbortController,
        TextEncoder,
        TextDecoder,
        queueMicrotask,
        setTimeout,
        clearTimeout,
      },
      { filename: entry },
    )
    if (module === undefined) throw new Error(`Native Client module ${id} did not supply a lazy factory.`)
    const exports = module.factory(request => load(request, entry))
    modules.set(entry, exports)
    return exports
  }
  return load
}
