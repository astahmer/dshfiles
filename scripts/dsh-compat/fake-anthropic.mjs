/**
 * A local stand-in for the Anthropic Messages endpoint that stock DSH's
 * DeepSeek API-key provider calls (`$DEEPSEEK_BASE_URL/v1/messages`). It
 * answers every request with "OK" and keeps each request body, so a test can
 * read what a preset actually sent: its system prompt and its tool list. No
 * credentials, no network.
 */
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

const sse = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`

export const startFakeAnthropic = async ({ reply = 'OK' } = {}) => {
  const requests = []
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    if (request.method !== 'POST' || !/\/messages(?:\?|$)/u.test(request.url ?? '')) {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: `fake: no ${request.method} ${request.url}` } }))
      return
    }
    const parsed = JSON.parse(body)
    requests.push(parsed)
    const message = { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model: parsed.model, stop_sequence: null }
    const usage = { input_tokens: 12, output_tokens: 1 }
    if (parsed.stream !== true) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ...message, content: [{ type: 'text', text: reply }], stop_reason: 'end_turn', usage }))
      return
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    response.end(
      sse('message_start', { message: { ...message, content: [], stop_reason: null, usage } }) +
        sse('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) +
        sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text: reply } }) +
        sse('content_block_stop', { index: 0 }) +
        sse('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }) +
        sse('message_stop', {}),
    )
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${String(port)}`,
    requests,
    close: () => new Promise(resolve => server.close(() => resolve())),
  }
}
