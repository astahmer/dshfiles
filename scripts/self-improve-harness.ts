import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/**
 * Deterministic validation of the parts of the harness this repository owns:
 * the project skill bundles and the always-on agent instructions.
 *
 * Ported from Harness²'s `tree.validate()`, which reports every problem in one
 * message and feeds the prose back verbatim as retry feedback. Nothing here
 * calls a model, so a finding is a fact about the tree, not a judgement.
 */

/** An always-on instructions file competes with the agent's own output budget. */
const ALWAYS_ON_MAX_CHARS = 24_000
export const DESCRIPTION_MAX_CHARS = 1_024
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export interface HarnessFinding {
  readonly severity: 'error' | 'warning'
  readonly code: string
  readonly path: string
  readonly message: string
}

export interface SkillSummary {
  readonly name: string
  readonly description: string
  readonly path: string
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
}

export interface HarnessCensus {
  readonly root: string
  readonly skills: readonly SkillSummary[]
  readonly alwaysOn: readonly { readonly path: string; readonly chars: number }[]
}

export interface HarnessValidation {
  readonly census: HarnessCensus
  readonly findings: readonly HarnessFinding[]
}

const FRONTMATTER_KEY = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/

/** The subset of YAML frontmatter skills use: flat `key: value` pairs. */
const parseFrontmatter = (text: string): { readonly fields: ReadonlyMap<string, string>; readonly body: string } | undefined => {
  if (!text.startsWith('---')) return undefined
  const end = text.indexOf('\n---', 3)
  if (end < 0) return undefined
  const fields = new Map<string, string>()
  for (const line of text.slice(text.indexOf('\n') + 1, end).split('\n')) {
    const match = FRONTMATTER_KEY.exec(line)
    if (match === null) continue
    const value = (match[2] ?? '').trim().replace(/^["']|["']$/g, '')
    fields.set(match[1] ?? '', value)
  }
  return { fields, body: text.slice(end + 4) }
}

const SKILL_FILES = /^SKILL\.md$/
const FLAT_SKILL = /^([a-z0-9-]+)\.md$/

export interface SkillFile {
  readonly name: string
  readonly path: string
}

/** Directory bundles (`<name>/SKILL.md`) and flat files (`<name>.md`), as DSH discovers them. */
const discoverSkillFiles = async (root: string): Promise<SkillFile[]> => {
  const found: SkillFile[] = []
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) {
      const path = join(root, entry.name, 'SKILL.md')
      if (
        await stat(path)
          .then(info => info.isFile())
          .catch(() => false)
      )
        found.push({ name: entry.name, path })
      continue
    }
    const flat = FLAT_SKILL.exec(entry.name)
    if (flat !== null && !SKILL_FILES.test(entry.name)) found.push({ name: flat[1] ?? '', path: join(root, entry.name) })
  }
  return found
}

const LINK = /\[[^\]]*\]\(<?([^)\s>]+)>?\)/g

/** Relative markdown link targets that do not exist on disk. */
/**
 * A link inside a fenced block is documentation — a template, a directory tree —
 * not a navigable target. Scanning it flagged `write-a-skill`, whose example tree
 * lists REFERENCE.md as an *example* of what a skill may contain.
 */
const withoutCodeFences = (body: string): string => body.replace(/```[\s\S]*?```/g, '')

const missingLinks = async (filePath: string, body: string): Promise<string[]> => {
  const missing: string[] = []
  for (const match of withoutCodeFences(body).matchAll(LINK)) {
    const target = match[1] ?? ''
    if (target.startsWith('http') || target.startsWith('#') || target.startsWith('mailto:') || target.includes('{{')) continue
    const path = target.split('#')[0] ?? ''
    if (path.length === 0) continue
    const resolved = resolve(dirname(filePath), path)
    if (!(await stat(resolved).catch(() => undefined))) missing.push(target)
  }
  return missing
}

const validateSkill = async (file: SkillFile): Promise<{ readonly skill: SkillSummary | undefined; readonly findings: HarnessFinding[] }> => {
  const findings: HarnessFinding[] = []
  const text = await readFile(file.path, 'utf8')
  const parsed = parseFrontmatter(text)
  if (parsed === undefined) {
    findings.push({
      severity: 'error',
      code: 'skill.frontmatter-missing',
      path: file.path,
      message:
        'no YAML frontmatter: DSH drops a skill without `name` and `description`, so this skill is invisible to both the model catalog and `/name` commands',
    })
    return { skill: undefined, findings }
  }
  const name = parsed.fields.get('name') ?? ''
  const description = parsed.fields.get('description') ?? ''
  if (name.length === 0)
    findings.push({ severity: 'error', code: 'skill.name-missing', path: file.path, message: `frontmatter has no \`name\`; add \`name: ${file.name}\`` })
  else if (!NAME_PATTERN.test(name))
    findings.push({ severity: 'error', code: 'skill.name-invalid', path: file.path, message: `name \`${name}\` is not kebab-case` })
  else if (name !== file.name)
    findings.push({
      severity: 'error',
      code: 'skill.name-mismatch',
      path: file.path,
      message: `name \`${name}\` does not match its ${file.name.includes('.md') ? 'file' : 'directory'} name \`${file.name}\``,
    })
  if (description.length === 0)
    findings.push({
      severity: 'error',
      code: 'skill.description-missing',
      path: file.path,
      message: 'frontmatter has no `description`; the description is the only thing the model sees when choosing a skill',
    })
  else if (description.length > DESCRIPTION_MAX_CHARS)
    findings.push({
      severity: 'error',
      code: 'skill.description-too-long',
      path: file.path,
      message: `description is ${String(description.length)} chars, over the ${String(DESCRIPTION_MAX_CHARS)} cap DSH accepts`,
    })
  for (const target of await missingLinks(file.path, parsed.body)) {
    findings.push({ severity: 'warning', code: 'skill.link-missing', path: file.path, message: `relative link target \`${target}\` does not exist` })
  }
  // An omitted key permits its surface. `disable-model-invocation: true` refuses the model surface,
  // `user-invocable: false` refuses the human one.
  const flag = (key: string): boolean | undefined => {
    const value = parsed.fields.get(key)
    return value === undefined ? undefined : value.toLowerCase() !== 'false'
  }
  return {
    skill:
      name.length === 0
        ? undefined
        : { name, description, path: file.path, modelInvocable: flag('disable-model-invocation') !== true, userInvocable: flag('user-invocable') !== false },
    findings,
  }
}

const readChars = async (path: string): Promise<{ readonly path: string; readonly chars: number } | undefined> => {
  const text = await readFile(path, 'utf8').catch(() => undefined)
  return text === undefined ? undefined : { path, chars: text.length }
}

const READABLE_PATH = /\.(?:md|jsonl|feature|ya?ml|toml)$/

/**
 * File paths an always-on instructions file tells the agent to read.
 *
 * A dead path here is expensive: every Session in every repository pays a failed
 * tool call, and the model retries it after each context compaction. 328 mined
 * Sessions opened `~/.agents/USER_PREFERENCES.md`, which exists in no checkout.
 * The scan deliberately ignores templates, globs, environment references and
 * bare names so a placeholder never becomes a false finding.
 */
const referencedPaths = (text: string): string[] => {
  const found = new Set<string>()
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    const token = (match[1] ?? '').trim()
    if (token.length === 0 || /[*<>$?]|\{\{|\.\.\.|\s/.test(token)) continue
    if (!token.includes('/') || !READABLE_PATH.test(token)) continue
    found.add(token)
  }
  return [...found]
}

const resolveReferenced = (from: string, token: string): string => {
  if (token.startsWith('/')) return token
  if (token.startsWith('~/')) return join(homedir(), token.slice(2))
  return resolve(dirname(from), token)
}

const validateInstructions = async (path: string): Promise<HarnessFinding[]> => {
  const text = await readFile(path, 'utf8').catch(() => undefined)
  if (text === undefined) return []
  const findings: HarnessFinding[] = []
  for (const token of referencedPaths(text)) {
    const target = resolveReferenced(path, token)
    const exists = await stat(target)
      .then(() => true)
      .catch(() => false)
    if (exists) continue
    findings.push({
      severity: 'warning',
      code: 'instructions.path-missing',
      path,
      message: `points at \`${token}\`, which does not exist on this machine; every Session pays a failed read for it`,
    })
  }
  return findings
}

export interface ValidateHarnessInput {
  readonly root: string
  readonly skillRoots: readonly string[]
  readonly alwaysOnPaths: readonly string[]
}

const validateHarness = async (input: ValidateHarnessInput): Promise<HarnessValidation> => {
  const findings: HarnessFinding[] = []
  const skills: SkillSummary[] = []
  for (const root of input.skillRoots) {
    for (const file of await discoverSkillFiles(root)) {
      const result = await validateSkill(file)
      findings.push(...result.findings)
      if (result.skill !== undefined) skills.push(result.skill)
    }
  }

  const seen = new Map<string, SkillSummary>()
  for (const skill of skills) {
    const previous = seen.get(skill.name)
    if (previous === undefined) {
      seen.set(skill.name, skill)
      continue
    }
    findings.push({
      severity: 'warning',
      code: 'skill.duplicate-name',
      path: skill.path,
      message: `\`${skill.name}\` is also declared by ${previous.path}; DSH resolves one winner by root rank, so the other is dead weight`,
    })
  }

  const alwaysOn: { path: string; chars: number }[] = []
  for (const path of input.alwaysOnPaths) {
    const entry = await readChars(path)
    if (entry === undefined) continue
    alwaysOn.push(entry)
    if (entry.chars > ALWAYS_ON_MAX_CHARS) {
      findings.push({
        severity: 'warning',
        code: 'instructions.always-on-over-budget',
        path,
        message: `${String(entry.chars)} chars is over the ${String(ALWAYS_ON_MAX_CHARS)} budget; every token here competes with the agent's own output budget, so move detail into a skill or docs`,
      })
    }
    findings.push(...(await validateInstructions(path)))
  }

  return { census: { root: input.root, skills: [...seen.values()].sort((left, right) => left.name.localeCompare(right.name)), alwaysOn }, findings }
}

const renderHarnessValidation = (validation: HarnessValidation): string => {
  const lines = [
    `# Harness validation`,
    '',
    `- skills: ${String(validation.census.skills.length)} (${String(validation.census.skills.filter(skill => skill.modelInvocable).length)} model-invocable, ${String(validation.census.skills.filter(skill => skill.userInvocable).length)} user-invocable)`,
    ...validation.census.alwaysOn.map(entry => `- always-on: ${entry.path} ${String(entry.chars)} chars`),
    '',
  ]
  if (validation.findings.length === 0) lines.push('No findings.')
  for (const finding of validation.findings) lines.push(`- **${finding.severity}** \`${finding.code}\` ${finding.path} — ${finding.message}`)
  return `${lines.join('\n')}\n`
}

/**
 * Deterministic audit of the parts of the harness this repository owns: the
 * project skill bundles and the always-on agent instructions.
 */
export class HarnessAudit {
  static readonly parseFrontmatter = parseFrontmatter
  static readonly referencedPaths = referencedPaths
  static readonly validate = validateHarness
  static readonly render = renderHarnessValidation
}
