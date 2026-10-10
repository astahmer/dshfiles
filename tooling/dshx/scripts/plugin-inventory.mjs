import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const ownsRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value)
const packageIdPattern = /^@dshfiles\/[a-z0-9][a-z0-9-]*$/
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/

export const listPluginBundles = async pluginsRoot => {
  const entries = await readdir(pluginsRoot, { withFileTypes: true })
  const plugins = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const packageFile = resolve(pluginsRoot, entry.name, 'package.json')
    let source
    try {
      source = await readFile(packageFile, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
    let manifest
    try {
      manifest = JSON.parse(source)
    } catch (error) {
      throw new Error(`${packageFile} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!ownsRecord(manifest)) throw new Error(`${packageFile} must contain a JSON object.`)
    if (manifest.dsh === undefined) continue
    if (!ownsRecord(manifest.dsh)) throw new Error(`${packageFile} dsh metadata must be an object.`)
    if (!ownsRecord(manifest.dsh.bundle) || typeof manifest.dsh.bundle.patch !== 'string') {
      throw new Error(`${packageFile} has dsh metadata but no bundle patch.`)
    }
    if (manifest.dsh.client !== undefined && !ownsRecord(manifest.dsh.client)) {
      throw new Error(`${packageFile} dsh.client metadata must be an object.`)
    }
    if (typeof manifest.name !== 'string' || !packageIdPattern.test(manifest.name)) {
      throw new Error(`${packageFile} must have a scoped @dshfiles package name.`)
    }
    if (manifest.name !== `@dshfiles/${entry.name}`) {
      throw new Error(`${packageFile} name ${manifest.name} does not match directory ${entry.name}.`)
    }
    plugins.push({
      id: manifest.name,
      dir: resolve(pluginsRoot, entry.name),
      hasClient: ownsRecord(manifest.dsh.client),
    })
  }
  return plugins.sort((left, right) => left.id.localeCompare(right.id))
}

export const readBootIgnores = async ignoreFile => {
  let source
  try {
    source = await readFile(ignoreFile, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  try {
    const value = JSON.parse(source)
    if (!Array.isArray(value)) throw new Error('the document root must be an array')
    return value
  } catch (error) {
    throw new Error(`${ignoreFile} is not a valid boot ignore list: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export const validateBootIgnores = (ignores, plugins, today = new Date()) => {
  if (!Array.isArray(ignores)) throw new Error('Boot ignore list must be an array.')
  const pluginIds = new Set(plugins.map(plugin => plugin.id))
  const ignoredIds = new Set()
  for (const [index, ignore] of ignores.entries()) {
    const label = `Boot ignore entry ${index + 1}`
    if (!ownsRecord(ignore)) throw new Error(`${label} must be an object.`)
    if (typeof ignore.packageId !== 'string' || !packageIdPattern.test(ignore.packageId)) {
      throw new Error(`${label} packageId must be a scoped @dshfiles package id.`)
    }
    if (!pluginIds.has(ignore.packageId)) throw new Error(`${label} references unknown plugin ${ignore.packageId}.`)
    if (ignoredIds.has(ignore.packageId)) throw new Error(`${label} duplicates ${ignore.packageId}.`)
    ignoredIds.add(ignore.packageId)
    if (typeof ignore.reason !== 'string' || ignore.reason.trim() === '') throw new Error(`${label} needs a non-empty reason.`)
    if (typeof ignore.owner !== 'string' || ignore.owner.trim() === '') throw new Error(`${label} needs a non-empty owner.`)
    if (typeof ignore.removalCondition !== 'string' || ignore.removalCondition.trim() === '') {
      throw new Error(`${label} needs a non-empty removalCondition.`)
    }
    if (ignore.expiresOn !== undefined) {
      if (typeof ignore.expiresOn !== 'string' || !isoDatePattern.test(ignore.expiresOn)) {
        throw new Error(`${label} expiresOn must be a YYYY-MM-DD date.`)
      }
      const expiry = new Date(`${ignore.expiresOn}T00:00:00.000Z`)
      if (Number.isNaN(expiry.valueOf()) || expiry.toISOString().slice(0, 10) !== ignore.expiresOn) {
        throw new Error(`${label} expiresOn is not a real calendar date.`)
      }
      if (ignore.expiresOn < today.toISOString().slice(0, 10)) {
        throw new Error(`${label} for ${ignore.packageId} expired on ${ignore.expiresOn}.`)
      }
    }
  }
  return ignoredIds
}

export const pluginsToBoot = (plugins, ignoredIds) => plugins.filter(plugin => !ignoredIds.has(plugin.id))
