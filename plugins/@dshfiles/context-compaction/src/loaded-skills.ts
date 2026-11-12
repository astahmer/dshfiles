import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'

/** What a checkpoint keeps of the skills loaded in the span it replaces. */
export type LoadedSkillsMode = 'off' | 'names' | 'bodies'

interface LoadedSkill {
  readonly name: string
  readonly directory: string | undefined
  readonly body: string | undefined
}

/** Kept skill instructions per checkpoint; a skill past it keeps only its name. */
export const MAX_KEPT_SKILL_CHARS = 32_000

const SKILL_RESULT = /^<skill_content name="([^"]+)">/
const SKILL_DIRECTORY = /Base directory for this skill: (\S+)/
const SKILL_BODY = /<skill_content name="([^"]+)">[\s\S]*?<\/skill_content>/g
const KEPT_BLOCK = /<loaded-skills>([\s\S]*?)<\/loaded-skills>/
const LISTED_SKILL = /^- (\S+)(?: \((.+)\))?$/gm
const CLOSING_TAG = '</skill_content>'

const textsOf = (message: Message) => message.content.flatMap(block => (block.type === 'text' ? [block.text] : []))

/**
 * The skills a replayed span loaded, in first-load order: the `skill` tool's results, and the list an earlier
 * checkpoint kept. Only tool results and that list count, so a skill quoted in conversation text is not mistaken for a
 * load.
 */
const loadedSkillsIn = (messages: readonly Message[]): readonly LoadedSkill[] => {
  const skills = new Map<string, LoadedSkill>()
  const add = (skill: LoadedSkill) => {
    const known = skills.get(skill.name)
    skills.set(skill.name, { name: skill.name, directory: skill.directory ?? known?.directory, body: skill.body ?? known?.body })
  }
  for (const message of messages)
    for (const text of textsOf(message)) {
      if (message.role === 'tool') {
        const name = SKILL_RESULT.exec(text)?.[1]
        if (name !== undefined) add({ name, directory: SKILL_DIRECTORY.exec(text)?.[1], body: text })
        continue
      }
      const kept = KEPT_BLOCK.exec(text)?.[1]
      if (kept === undefined) continue
      for (const match of kept.matchAll(SKILL_BODY))
        if (match[1] !== undefined) add({ name: match[1], directory: SKILL_DIRECTORY.exec(match[0])?.[1], body: match[0] })
      for (const match of kept.replace(SKILL_BODY, '').matchAll(LISTED_SKILL))
        if (match[1] !== undefined) add({ name: match[1], directory: match[2], body: undefined })
    }
  return [...skills.values()]
}

const closed = (body: string) => (body.trimEnd().endsWith(CLOSING_TAG) ? body : `${body}\n${CLOSING_TAG}`)

const keptBodies = (skills: readonly LoadedSkill[]) => {
  const bodies: string[] = []
  let used = 0
  for (const skill of skills) {
    if (skill.body === undefined) continue
    const body = closed(skill.body)
    if (used + body.length > MAX_KEPT_SKILL_CHARS) continue
    bodies.push(body)
    used += body.length
  }
  return bodies
}

/**
 * The checkpoint summary with the skills its span loaded appended, so the thread still knows them after the span is
 * replaced: their names (and directories), and in `bodies` mode their instructions up to {@link MAX_KEPT_SKILL_CHARS}.
 * The block is carried into every later checkpoint that replaces this one.
 */
export const withLoadedSkills = (input: {
  readonly summary: readonly ContentBlock[]
  readonly messages: readonly Message[]
  readonly mode: LoadedSkillsMode
}): ContentBlock[] => {
  if (input.mode === 'off') return [...input.summary]
  const skills = loadedSkillsIn(input.messages)
  if (skills.length === 0) return [...input.summary]
  const listed = skills.map(skill => `- ${skill.name}${skill.directory === undefined ? '' : ` (${skill.directory})`}`)
  const bodies = input.mode === 'bodies' ? keptBodies(skills) : []
  const guidance =
    bodies.length === 0
      ? 'Skills this thread loaded before this checkpoint. Their instructions still apply; load one again only to reread a detail.'
      : 'Skills this thread loaded before this checkpoint, with the instructions kept below. They still apply; load one again only if its instructions are not kept here.'
  return [...input.summary, { type: 'text', text: ['<loaded-skills>', guidance, ...listed, ...bodies, '</loaded-skills>'].join('\n') }]
}
