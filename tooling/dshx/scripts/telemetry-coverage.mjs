import { readFile, readdir } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'

const TEST_FILE = /(?:\.test\.|\.spec\.|test-support|[/\\](?:tests?|fixtures|__tests__)[/\\])/u
const SOURCE_FILE = /\.(?:ts|tsx|mts)$/u

/**
 * Host code that leaves the process: a network request, a listening socket, a child process. A file matching one of
 * these opens a span itself, or the catalog names it in `ioDelegation` with the span its caller opens.
 */
const IO_PRIMITIVES = [
  { label: 'fetch', pattern: /(?<![\w$.])fetch\s*\(|\?\?\s*fetch\)\s*\(|\bglobalThis\.fetch\s*\(/u },
  { label: 'WebSocket', pattern: /\bnew WebSocket\(/u },
  { label: 'node:http/net', pattern: /^import\s+(?!type\b)(?:\{[^}]*\}|[^\n{])*?from ['"]node:(?:https?|net|dgram|tls)['"]/mu },
  { label: 'child_process', pattern: /^import\s+(?!type\b)(?:\{[^}]*\}|[^\n{])*?from ['"]node:child_process['"]/mu },
  { label: 'subprocess spawn', pattern: /\.spawn\(\s*\{|\bresolveExecutable\(/u },
]
const SPAN_PRIMITIVE = /\b(?:withSpan|traced|startSpan)\(/u

/** What makes an automatic source true for a plugin: its Host code does the thing that emits the span. */
const AUTOMATIC_EVIDENCE = {
  'api-dispatch': { pattern: /\bdefineApi\(/u, needs: 'a dshx API (defineApi) in its Host or module code' },
  'agent-tool': { pattern: /\bdefineTool\(|\btool:\s*\{/u, needs: 'an agent tool (defineTool or a dshx method tool binding)' },
  'model-stream': { pattern: /\bctx\.llm\b|\.get\(\s*['"]llm['"]\s*\)|inject:\s*\[[^\]]*['"]llm['"]/u, needs: 'a ctx.llm stream' },
  jj: { pattern: /@dshfiles\/(?:jujutsu|jj-integration)\b/u, needs: 'a call into the jujutsu or jj-integration Host API' },
  secret: { pattern: /\bsecretCatalogValues\b/u, needs: "a ctx.get('secretCatalogValues') resolve" },
  'multi-host': { pattern: /@dshfiles\/multi-host\b/u, needs: 'a call into the multi-host gateway' },
}

const isWithin = (root, target) => {
  const relativePath = relative(root, target)
  return relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && relativePath !== ''
}

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

/** `jj <subcommand>` → a pattern over a source string literal or template (`jj ${verb}`) and over a concrete name. */
const spanNamePatterns = name => {
  const parts = name.split(/(<[^>]+>)/u).filter(part => part !== '')
  const source = parts.map(part => (part.startsWith('<') ? '(?:\\$\\{[^\\n`]*?\\}|[^\'"`\\n]+)' : escapeRegExp(part))).join('')
  const concrete = parts.map(part => (part.startsWith('<') ? '[^\'"`\\n]+' : escapeRegExp(part))).join('')
  return { source: new RegExp(`['"\`]${source}['"\`]`, 'u'), concrete: new RegExp(`['"\`]${concrete}['"\`]`, 'u') }
}

const readText = async file => {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return undefined
  }
}

/** A `dshx create` catalog names its tests from the package root (`tests/x.spec.ts`); this repository's from its root. */
export const readPackageRelative = async (packageRoot, file) => {
  const target = resolve(packageRoot, file)
  return isWithin(packageRoot, target) ? readText(target) : undefined
}

const listSourceFiles = async directory => {
  const files = []
  const walk = async current => {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = resolve(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'dist') await walk(path)
        continue
      }
      if (SOURCE_FILE.test(entry.name) && !entry.name.endsWith('.d.ts')) files.push(path)
    }
  }
  await walk(directory)
  return files
}

const resolveImport = async (fromFile, specifier) => {
  const base = resolve(dirname(fromFile), specifier)
  const stem = base.replace(/\.(?:js|mjs|jsx|ts|tsx)$/u, '')
  for (const candidate of [`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, resolve(stem, 'index.ts'), resolve(stem, 'index.tsx')]) {
    if ((await readText(candidate)) !== undefined) return candidate
  }
  return undefined
}

const RELATIVE_IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/gu

/** The Host entry and dshx modules of `dshx.config.ts`, with every relative import they reach; a package without one is a library: all its sources. */
const hostSourceFiles = async packageRoot => {
  const config = await readText(resolve(packageRoot, 'dshx.config.ts'))
  const hostEntry = config === undefined ? undefined : /host:\s*\{[^}]*?entry:\s*['"]([^'"]+)['"]/su.exec(config)?.[1]
  if (hostEntry === undefined) {
    const all = await listSourceFiles(resolve(packageRoot, 'src'))
    return all.filter(file => !TEST_FILE.test(relative(packageRoot, file)))
  }
  const moduleBlock = /modules:\s*\{([^}]*)\}/su.exec(config ?? '')?.[1] ?? ''
  const roots = [hostEntry, ...[...moduleBlock.matchAll(/['"]([^'"]+\.tsx?)['"]/gu)].map(match => match[1])]
  const seen = new Set()
  // A Host entry a pre-build step emits (`build/host/host.js`) is read from its TypeScript source under src/.
  const queue = await Promise.all(
    roots.map(async root =>
      /^(?:build|dist)\//u.test(root)
        ? ((await resolveImport(resolve(packageRoot, 'src/entry'), `./${root.replace(/^(?:build|dist)\/(?:host\/)?/u, '')}`)) ?? resolve(packageRoot, root))
        : resolve(packageRoot, root),
    ),
  )
  while (queue.length > 0) {
    const file = queue.pop()
    if (file === undefined || seen.has(file)) continue
    const source = await readText(file)
    if (source === undefined) continue
    seen.add(file)
    for (const match of source.matchAll(RELATIVE_IMPORT)) {
      const target = await resolveImport(file, match[1])
      if (target !== undefined && isWithin(packageRoot, target) && !seen.has(target)) queue.push(target)
    }
  }
  return [...seen].filter(file => !TEST_FILE.test(relative(packageRoot, file))).sort()
}

const OWNED_MODULE_IMPORT = /from\s+['"]@dshfiles\/([a-z0-9-]+)\/([a-z0-9-]+)['"]/gu

/**
 * Sources of the dshx modules this package imports from other owned plugins (`@dshfiles/x/some-api`): an API or tool
 * a feature drives can be declared there, and its dispatch span is still what the feature's work emits.
 */
const importedModuleText = async ({ workspaceRoot, packageRoot }) => {
  const texts = []
  const seen = new Set()
  for (const file of await listSourceFiles(resolve(packageRoot, 'src'))) {
    for (const match of ((await readText(file)) ?? '').matchAll(OWNED_MODULE_IMPORT)) {
      const key = `${match[1]}/${match[2]}`
      if (seen.has(key)) continue
      seen.add(key)
      const config = await readText(resolve(workspaceRoot, 'plugins/@dshfiles', match[1], 'dshx.config.ts'))
      const modulePath = config === undefined ? undefined : new RegExp(`['"]?${escapeRegExp(match[2])}['"]?\\s*:\\s*['"]([^'"]+)['"]`, 'u').exec(config)?.[1]
      const text = modulePath === undefined ? undefined : await readText(resolve(workspaceRoot, 'plugins/@dshfiles', match[1], modulePath))
      if (text !== undefined) texts.push(text)
    }
  }
  return texts.join('\n')
}

/** The text of one test: from the line naming it to the next test, suite or hook call. */
const testBlock = (source, testName) => {
  const start = source.indexOf(testName)
  if (start < 0) return undefined
  const lineStart = source.lastIndexOf('\n', start) + 1
  const rest = source.slice(lineStart)
  const next = /\n\s*(?:it|test|describe|beforeEach|afterEach|beforeAll|afterAll)(?:\.\w+)*\s*\(/u.exec(rest.slice(1))
  return next === null ? rest : rest.slice(0, next.index + 1)
}

/**
 * Check one catalog's telemetry contract against its package: automatic sources need Host evidence, custom spans need
 * a source string that emits the name and a test that records it with `recordSpans()`, and every Host file that does
 * I/O opens a span or is delegated by name.
 */
export const telemetryIssues = async ({ workspaceRoot, packageRoot, catalog }) => {
  const issues = []
  const counts = { automatic: 0, custom: 0, 'not-applicable': 0 }
  const files = await hostSourceFiles(packageRoot)
  const sources = new Map()
  for (const file of files) sources.set(file, (await readText(file)) ?? '')
  const hostText = [...sources.values()].join('\n')
  const evidenceText = `${hostText}\n${await importedModuleText({ workspaceRoot, packageRoot })}`
  const customSpans = new Set()

  for (const feature of catalog.features) {
    for (const entry of feature.telemetry) {
      counts[entry.kind] += 1
      if (entry.kind === 'automatic') {
        const evidence = AUTOMATIC_EVIDENCE[entry.source]
        if (!evidence.pattern.test(evidenceText)) {
          issues.push(
            `feature ${feature.id} telemetry ${entry.source} needs ${evidence.needs}; none was found in the package's Host code or the owned dshx modules it imports`,
          )
        }
        continue
      }
      if (entry.kind !== 'custom') continue
      customSpans.add(entry.span)
      const patterns = spanNamePatterns(entry.span)
      if (!patterns.source.test(hostText))
        issues.push(`feature ${feature.id} telemetry span "${entry.span}" is not emitted by any Host source string of this package`)
      const testFile = resolve(workspaceRoot, entry.file)
      if (!isWithin(workspaceRoot, testFile)) {
        issues.push(`feature ${feature.id} telemetry test path ${entry.file} must stay inside the repository`)
        continue
      }
      const testSource = (await readText(testFile)) ?? (await readPackageRelative(packageRoot, entry.file))
      if (testSource === undefined) {
        issues.push(`feature ${feature.id} telemetry test file ${entry.file} does not exist`)
        continue
      }
      const block = testBlock(testSource, entry.testName)
      if (block === undefined) {
        issues.push(`feature ${feature.id} telemetry test ${entry.testName} was not found in ${entry.file}`)
        continue
      }
      if (!/\brecordSpans\(/u.test(block)) issues.push(`feature ${feature.id} telemetry test ${entry.testName} must call recordSpans()`)
      if (!patterns.concrete.test(block)) issues.push(`feature ${feature.id} telemetry test ${entry.testName} never names span "${entry.span}"`)
    }
  }

  const delegated = new Map()
  for (const delegation of catalog.ioDelegation ?? []) {
    const file = resolve(packageRoot, delegation.file)
    if (!sources.has(file)) {
      issues.push(`ioDelegation ${delegation.file} is not a Host source file of this package`)
      continue
    }
    if (delegation.tracedBy !== undefined && !customSpans.has(delegation.tracedBy)) {
      issues.push(`ioDelegation ${delegation.file} tracedBy "${delegation.tracedBy}" is not a custom span declared by this catalog`)
    }
    delegated.set(file, delegation)
  }
  for (const [file, source] of sources) {
    const primitives = IO_PRIMITIVES.filter(primitive => primitive.pattern.test(source)).map(primitive => primitive.label)
    const relativeFile = relative(packageRoot, file)
    const delegation = delegated.get(file)
    if (primitives.length === 0) {
      if (delegation !== undefined) issues.push(`ioDelegation ${relativeFile} does no I/O any more; remove the entry`)
      continue
    }
    if (SPAN_PRIMITIVE.test(source)) {
      if (delegation !== undefined) issues.push(`ioDelegation ${relativeFile} opens its own span; remove the entry`)
      continue
    }
    if (delegation === undefined) {
      issues.push(
        `Host file ${relativeFile} does I/O (${primitives.join(', ')}) without a span: wrap the work unit in withSpan/traced, or add an ioDelegation entry naming the span its caller opens`,
      )
    }
  }
  return { issues, counts }
}
