import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pathKeys = ['sourceRoot', 'dshHome', 'nodeBinary', 'coreEntry', 'homeVerificationFile', 'browserExecutable']
const environmentKeys = {
  sourceRoot: 'DSHFILES_DIR',
  dshHome: 'DSH_HOME',
  nodeBinary: 'DSHFILES_NODE_BINARY',
  coreEntry: 'DSH_CORE_ENTRY',
  profile: 'DSHFILES_PROFILE',
  legacyPort: 'DSHFILES_LEGACY_PORT',
  homeVerificationFile: 'DSHFILES_HOME_VERIFICATION_FILE',
  browserExecutable: 'DSHX_CHROMIUM_EXECUTABLE',
  path: 'DSHFILES_PATH',
  nodePath: 'DSHFILES_NODE_PATH',
}

export class LauncherConfig {
  // Bootstrap must work before pnpm installs any schema library. Validate the full
  // JSON contract here, not just its representation; no arbitrary shell/env maps.
  static load(env = process.env) {
    const home = env.HOME || homedir()
    const configPath = env.DSHFILES_LAUNCHER_CONFIG ?? join(env.XDG_CONFIG_HOME || join(home, '.config'), 'dshfiles/launcher.json')
    if (!isAbsolute(configPath)) throw new Error('Launcher config path must be absolute')
    let local = {}
    try {
      const text = readFileSync(configPath, 'utf8')
      try {
        local = JSON.parse(text)
      } catch {
        throw new Error('Launcher config must be valid JSON')
      }
    } catch (error) {
      if (error.code !== 'ENOENT' || env.DSHFILES_LAUNCHER_CONFIG) throw error
    }
    // eslint-disable-next-line antislop/no-runtime-typeof -- Dependency-free JSON boundary, followed by full key/value validation.
    if (!local || typeof local !== 'object' || Array.isArray(local)) throw new Error('Launcher config must be an object')
    for (const key of Object.keys(local)) {
      if (!Object.hasOwn(environmentKeys, key)) throw new Error('Unknown launcher config key')
    }
    const config = {
      sourceRoot: resolve(fileURLToPath(new URL('..', import.meta.url))),
      dshHome: join(home, '.dsh'),
      nodeBinary: process.execPath,
      profile: 'web',
      ...local,
    }
    for (const [key, variable] of Object.entries(environmentKeys)) {
      if (env[variable] === undefined) continue
      if (key === 'legacyPort' && !/^\d+$/.test(env[variable])) throw new Error('legacyPort environment override must be an integer')
      config[key] = key === 'legacyPort' ? Number(env[variable]) : env[variable]
    }
    for (const [key, value] of Object.entries(config)) {
      if (key === 'legacyPort') {
        if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error('legacyPort must be an integer from 0 through 65535')
        // eslint-disable-next-line antislop/no-runtime-typeof -- JSON string validation is the bootstrap schema, before paths/grammar are accepted.
      } else if (typeof value !== 'string' || !value.trim() || /[\0\r\n]/.test(value)) {
        throw new Error(`Launcher ${key} must be a nonempty single-line string`)
      }
    }
    for (const key of pathKeys) {
      if (config[key] !== undefined && !isAbsolute(config[key])) throw new Error(`Launcher ${key} must be an absolute path`)
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(config.profile)) throw new Error('Launcher profile must be a simple profile name')
    return config
  }

  static environment(config, env = process.env) {
    const result = { ...env }
    for (const key of ['DSH_PROFILE', 'DSH_PROFILE_DIR', 'DSH_SESSION_ID', 'DSH_WEB_URL', 'DSH_SHELL', 'DSH_RESTART_REQUEST_PATH', 'DSH_RESTART_RUN_ID'])
      delete result[key]
    // Pin resolved choices for preparation/restarts without changing HOME/XDG.
    for (const [key, variable] of Object.entries(environmentKeys)) {
      if (config[key] !== undefined) result[variable] = String(config[key])
    }
    if (config.path !== undefined) result.PATH = config.path
    if (config.nodePath !== undefined) result.NODE_PATH = config.nodePath
    return result
  }

  static requireCoreEntry(config) {
    if (!config.coreEntry) throw new Error('Configure coreEntry or DSH_CORE_ENTRY with the installed DSH core entry; nothing started')
    return config.coreEntry
  }

  static runningProfilePattern(config) {
    const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return `${escape(LauncherConfig.requireCoreEntry(config))}.*--profile(=| )${escape(config.profile)}( |$)`
  }
}
