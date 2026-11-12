import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import type { DomainInput } from '../context.js'
import { unsupportedMember } from '../unsupported.js'

interface Skill {
  id: string
  name: string
  description: string
  content: string
  path?: string
  autoinvoke: boolean
}

type SkillRegistration = { -readonly [K in keyof Parameters<Context['skills']['register']>[0]]: Parameters<Context['skills']['register']>[0][K] }

interface Editor {
  list: () => Skill[]
  get: (id: string) => Skill | undefined
  add: (skill: Skill) => void
  update: (id: string, update: (skill: Skill) => void) => void
  remove: (id: string) => void
}

export const skillDomain = (config: { readonly ctx: Context; readonly input: DomainInput }) => {
  const transforms = new Set<() => void>()
  const unsupported = (path: string) => unsupportedMember({ ...config.input, path })
  return new Proxy(
    {
      transform: async (callback: (editor: Editor) => void) => {
        if (config.ctx.get('skills') === undefined) throw new Error('DSH skills service is unavailable. Enable @deepseek-ai/dsh-skill and reload this plugin.')
        const skills = new Map<string, Skill>()
        let disposers: Array<() => void> = []
        const record = (path: string) => {
          void Promise.resolve(unsupported(path)()).catch(() => undefined)
        }
        const run = () => {
          for (const dispose of disposers) dispose()
          disposers = []
          skills.clear()
          callback({
            list: () => [...skills.values()],
            get: id => skills.get(id),
            add: skill => {
              skills.set(skill.id, { ...skill })
            },
            update: (id, update) => {
              const skill = skills.get(id)
              if (skill === undefined) record('skill.transform.update')
              else update(skill)
            },
            remove: id => {
              if (!skills.delete(id)) record('skill.transform.remove')
            },
          })
          for (const skill of skills.values()) {
            const info: SkillRegistration = {
              name: skill.name,
              description: skill.description,
              content: skill.content,
              source: 'runtime',
              invocation: { modelInvocable: skill.autoinvoke, userInvocable: true },
            }
            if (skill.path !== undefined) info.path = skill.path
            disposers.push(config.ctx.skills.register(info))
            if (!config.input.contributions.skills.includes(skill.name)) config.input.contributions.skills.push(skill.name)
          }
        }
        const registration = await new Promise<ReturnType<DomainInput['register']>>((resolve, reject) => {
          const fiber = config.ctx.inject(['skills'], scoped => {
            try {
              config = { ...config, ctx: scoped }
              run()
              transforms.add(run)
            } catch (error) {
              for (const dispose of disposers) dispose()
              disposers = []
              reject(error)
            }
          })
          const registration = config.input.register({
            dispose: async () => {
              transforms.delete(run)
              for (const dispose of disposers) dispose()
              disposers = []
              await fiber.dispose()
            },
          })
          void Promise.resolve(fiber).then(() => resolve(registration), reject)
        })
        return registration
      },
      reload: async () => {
        for (const transform of transforms) transform()
      },
    },
    {
      get: (target, key) => {
        if (key in target) {
          // SAFETY: The key was checked against the target, including inherited properties.
          return target[key as keyof typeof target]
        }
        return typeof key === 'string' && key !== 'then' ? unsupported(`skill.${key}`) : undefined
      },
    },
  )
}
