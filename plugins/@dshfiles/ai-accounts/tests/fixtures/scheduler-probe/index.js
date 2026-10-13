import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds))

const writeResult = async result => {
  const resultPath = process.env.DSHX_SCHEDULE_PROBE_RESULT
  if (resultPath === undefined) throw new Error('The scratch result path is missing.')
  await mkdir(dirname(resultPath), { recursive: true })
  await writeFile(resultPath, `${JSON.stringify(result)}\n`)
}

const verifyScheduledDelivery = async ctx => {
  const session = await ctx.sessionController.create({ cwd: process.cwd() })
  const prompt = `scratch quota schedule probe ${process.pid}`
  const task = await ctx.schedule.create(session.sessionId, {
    title: 'Scratch quota schedule probe',
    prompt,
    after_seconds: 1,
  })
  const expiresAt = Date.now() + 20_000

  while (Date.now() < expiresAt) {
    const history = await ctx.schedule.history({ sessionId: session.sessionId, id: task.id, limit: 10 })
    const receipt = history.records.find(record => record.prompt === prompt)
    if (receipt !== undefined) {
      const inspection = await ctx.sessionController.inspect(session.sessionId)
      const event = inspection.events.find(
        candidate => candidate.type === 'user/message' && candidate.data?.source?.kind === 'schedule' && JSON.stringify(candidate.data).includes(prompt),
      )
      if (event !== undefined) {
        await writeResult({
          status: 'delivered',
          sessionId: String(session.sessionId),
          scheduleId: String(task.id),
          messageId: receipt.messageId,
          messageSeq: event.seq,
        })
        return
      }
    }
    await delay(50)
  }

  throw new Error('The original Session did not persist the scheduled message and receipt.')
}

export default {
  name: 'ai-accounts-scheduler-probe',
  inject: ['schedule', 'sessionController'],
  apply: ctx => {
    void verifyScheduledDelivery(ctx).catch(error => writeResult({ status: 'failed', errorName: error instanceof Error ? error.name : 'UnknownError' }))
  },
}
