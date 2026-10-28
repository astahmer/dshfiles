import { isMap, isScalar, isSeq, parseDocument, Scalar } from 'yaml'
import { z } from 'zod'

const scalarString = z.string()
const scalarBoolean = z.boolean()

const jsTag = 'tag:yaml.org,2002:js'
const managedStart = '# BEGIN NIX-MANAGED DSH PLUGINS'
const managedEnd = '# END NIX-MANAGED DSH PLUGINS'
const prefix = field => `ctx.webStartup.${field} ?? ctx.dshfilesNetworkStartup.${field} ?? `

const protectedRanges = text => {
  const ranges = []
  let start = null
  let offset = 0
  for (const line of text.split(/(?<=\n)/)) {
    const marker = line.trim()
    if (marker === managedStart) {
      if (start !== null) throw new Error('Nested Nix-managed profile regions are unsupported.')
      start = offset
    } else if (marker === managedEnd) {
      if (start === null) throw new Error('Unmatched Nix-managed profile region end.')
      ranges.push([start, offset + line.length])
      start = null
    }
    offset += line.length
  }
  if (start !== null) throw new Error('Unclosed Nix-managed profile region.')
  return ranges
}

const isJs = node => isScalar(node) && node.tag === jsTag && scalarString.safeParse(node.value).success
const isManaged = (node, field) => isJs(node) && node.value.startsWith(prefix(field))

const fallbackExpression = (node, field, legacyPort) => {
  if (node === undefined) return JSON.stringify(field === 'host' ? '127.0.0.1' : (legacyPort ?? 3080))
  if (!isScalar(node) || node.anchor) throw new Error(`webserver.config.${field} must be an unanchored literal or !!js scalar.`)
  if (isJs(node)) {
    if (!node.value.trim()) throw new Error(`webserver.config.${field} has an empty JavaScript expression.`)
    if (field === 'port' && legacyPort !== undefined && /^\s*ctx\.webStartup\.port\s*\?\?\s*3080\s*$/.test(node.value)) {
      return `ctx.webStartup.port ?? ${legacyPort}`
    }
    return node.value
  }
  if (node.tag !== undefined && !['tag:yaml.org,2002:str', 'tag:yaml.org,2002:int'].includes(node.tag)) {
    throw new Error(`webserver.config.${field} uses an unsupported scalar tag.`)
  }
  if (field === 'host' && !scalarString.safeParse(node.value).success) throw new Error('webserver.config.host must be a string literal or !!js expression.')
  if (field === 'port' && (!Number.isInteger(node.value) || node.value < 0 || node.value > 65535)) {
    throw new Error('webserver.config.port must be an integer from 0 through 65535 or a !!js expression.')
  }
  return JSON.stringify(field === 'port' && node.value === 3080 && legacyPort !== undefined ? legacyPort : node.value)
}

const delegatedScalar = (old, field, fallback) => {
  // Keep a trailing JavaScript line comment from swallowing the closing parenthesis.
  const closingLine = fallback.includes('//') || fallback.includes('\n') ? '\n' : ''
  const node = new Scalar(`${prefix(field)}(${fallback}${closingLine})`)
  node.tag = jsTag
  if (old !== undefined) {
    node.comment = old.comment
    node.commentBefore = old.commentBefore
    node.spaceBefore = old.spaceBefore
  }
  return node
}

const delegateWebserver = (document, protectedRegions, legacyPort) => {
  const rows = document.contents.items.filter(row => isMap(row) && row.get('id') === 'webserver')
  if (rows.length > 1) throw new Error('Profile has duplicate webserver rows; migrate them manually.')
  const row = rows[0]
  if (row === undefined || !row.has('config')) return false
  if (row.has('name') && row.get('name') !== '@deepseek-ai/dsh-host-webserver') {
    throw new Error('The webserver row does not name the native WebServer plugin.')
  }
  const [start, end] = row.range ?? []
  if (start === undefined || end === undefined) throw new Error('Cannot locate the webserver profile row.')
  if (protectedRegions.some(([left, right]) => start < right && end > left)) {
    throw new Error('Refusing to edit a webserver row inside a Nix-managed profile region.')
  }
  const config = row.get('config', true)
  if (!isMap(config) || config.anchor || row.anchor) throw new Error('webserver.config must be an unanchored mapping, not a whole-config expression or alias.')
  let injection
  if (row.has('inject')) {
    injection = row.get('inject', true)
    if (
      !isSeq(injection) ||
      injection.anchor ||
      injection.items.some(item => !isScalar(item) || item.tag !== undefined || !scalarString.safeParse(item.value).success)
    ) {
      throw new Error('Explicit webserver.inject must be an array of plain service-name strings.')
    }
  }
  const host = config.get('host', true)
  const port = config.get('port', true)
  if (isManaged(host, 'host') && isManaged(port, 'port')) return false
  // Validate both fields before changing either. Already-delegated fields remain untouched.
  const hostFallback = isManaged(host, 'host') ? null : fallbackExpression(host, 'host', legacyPort)
  const portFallback = isManaged(port, 'port') ? null : fallbackExpression(port, 'port', legacyPort)
  if (hostFallback !== null) config.set('host', delegatedScalar(host, 'host', hostFallback))
  if (portFallback !== null) config.set('port', delegatedScalar(port, 'port', portFallback))
  if (injection !== undefined) {
    const names = injection.items.map(item => item.value)
    for (const service of ['webStartup', 'dshfilesNetworkStartup']) if (!names.includes(service)) injection.add(service)
  }
  return true
}

const suppressNativePrint = (document, protectedRegions) => {
  const rows = document.contents.items.filter(row => isMap(row) && row.get('id') === 'web-runtime')
  if (rows.length > 1) throw new Error('Profile has duplicate web-runtime rows; migrate them manually.')
  const row = rows[0]
  if (row === undefined || !row.has('config')) return false
  if (row.has('name') && row.get('name') !== '@deepseek-ai/dsh-web-app') {
    throw new Error('The web-runtime row does not name the native Web app plugin.')
  }
  const [start, end] = row.range ?? []
  if (start === undefined || end === undefined) throw new Error('Cannot locate the web-runtime profile row.')
  if (protectedRegions.some(([left, right]) => start < right && end > left)) {
    throw new Error('Refusing to edit a web-runtime row inside a Nix-managed profile region.')
  }
  const config = row.get('config', true)
  if (!isMap(config) || config.anchor || row.anchor || config.has('<<')) {
    throw new Error('web-runtime.config must be an unanchored mapping, not a whole-config expression, merge or alias.')
  }
  const print = config.get('printUrl', true)
  if (print !== undefined) {
    if (
      !isScalar(print) ||
      print.anchor ||
      !scalarBoolean.safeParse(print.value).success ||
      (print.tag !== undefined && print.tag !== 'tag:yaml.org,2002:bool')
    ) {
      throw new Error('web-runtime.config.printUrl must be an unanchored boolean literal.')
    }
    if (print.value === false) return false
    // Updating the existing scalar retains its placement and attached comments.
    print.value = false
  } else config.set('printUrl', false)
  return true
}

/** Pure offline profile migration. It neither evaluates expressions nor reads or writes any file. */
export function networkStartupPatch(text, { legacyPort } = {}) {
  if (legacyPort !== undefined && (!Number.isInteger(legacyPort) || legacyPort < 0 || legacyPort > 65535)) {
    throw new Error('legacyPort must be an integer from 0 through 65535.')
  }
  const protectedRegions = protectedRanges(text)
  const document = parseDocument(text, { customTags: [{ tag: jsTag, resolve: value => value }] })
  if (document.errors.length) throw document.errors[0]
  if (!isSeq(document.contents)) throw new Error('Profile patch must be a YAML sequence.')
  const bindingChanged = delegateWebserver(document, protectedRegions, legacyPort)
  // Runtime printing is independent: absent or already-delegated binding rows
  // must not leave a later profile override re-enabling the native LAN-only line.
  const printingChanged = suppressNativePrint(document, protectedRegions)
  return bindingChanged || printingChanged ? String(document) : text
}
