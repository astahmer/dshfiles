export type RuntimeLaunchJournal = 'user' | 'user-unit'

export type RuntimeLaunch = {
  readonly port: number
  readonly token: string
}

export type RuntimeJournalReader = (source: RuntimeLaunchJournal) => Promise<string>

const runtimeLaunchFromJournal = (journal: string): RuntimeLaunch | undefined => {
  const matches = [...journal.matchAll(/http:\/\/127\.0\.0\.1:(\d{1,5})\/?\?token=([A-Za-z0-9._~-]{8,512})/g)]
  const last = matches.at(-1)
  const port = Number(last?.[1])
  const token = last?.[2]
  if (last === undefined || !Number.isInteger(port) || port < 1 || port > 65_535 || token === undefined) return undefined
  return { port, token }
}

export const readRuntimeLaunch = async ({ readJournal }: { readonly readJournal: RuntimeJournalReader }): Promise<RuntimeLaunch | undefined> => {
  const userJournal = runtimeLaunchFromJournal(await readJournal('user'))
  if (userJournal !== undefined) return userJournal
  return runtimeLaunchFromJournal(await readJournal('user-unit'))
}
