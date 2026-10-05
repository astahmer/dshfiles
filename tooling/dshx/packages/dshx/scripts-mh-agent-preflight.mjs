import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import WebSocket from 'ws'

const origin = process.env.MH_ORIGIN
const launchUrl = process.env.MH_URL
const workspace = process.env.MH_WS
const marker = `mh-agent-${crypto.randomUUID().slice(0, 8)}`

const exchange = await fetch(launchUrl, { redirect: 'manual' })
const cookie = exchange.headers
  .getSetCookie()
  .map(c => c.split(';', 1)[0])
  .join('; ')
const run = async (namespace, method, args) => {
  const response = await fetch(`${origin}/api/${encodeURIComponent(namespace)}/${encodeURIComponent(method)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: `${namespace}/${method}`, payload: { args } }),
  })
  const envelope = JSON.parse(await response.text())
  if (!envelope.result.ok) throw Object.assign(new Error(envelope.result.error?.message), { code: envelope.result.error?.code })
  return envelope.result.value
}
const safe = async (namespace, method, args) => {
  try {
    return { ok: true, value: await run(namespace, method, args) }
  } catch (error) {
    return { ok: false, code: error.code, message: String(error.message).slice(0, 200) }
  }
}

const models = await run('session', 'modelCatalog', {})
console.log(
  JSON.stringify(
    {
      default: models.default,
      routableProviders: models.routableProviders,
      failures: models.failures?.length ?? 0,
      allModels: models.groups.map(group => ({ group: group.id, ids: group.models.map(m => m.id) })),
    },
    null,
    1,
  ),
)
