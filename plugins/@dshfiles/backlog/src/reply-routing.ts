import type { TriageQuestion } from './triage.js'

export type ReplyRoute = 'reply' | 'thread'
export type ReplyRouteSource = 'jev' | 'keywords'

export interface ReplyRouteResult {
  readonly route: ReplyRoute
  readonly confidence: number
  readonly source: ReplyRouteSource
}

export const threadWorthyQuestion: TriageQuestion = {
  instructions: 'Should this message start a separate work thread, rather than be handled as a short answer or discussion reply on the existing backlog item?',
  criteria: {
    true: 'The user asks for code changes, implementation, debugging, investigation, a multi-step task, or other work that benefits from a dedicated thread',
    false: 'The user asks a question, requests a clarification, acknowledges something, or continues discussion that can be answered in this item’s replies',
  },
}

const workRequest =
  /^(?:(?:hey|hi|please|could you|can you|would you|i(?:'d| would) like you to|we should)\s+)*(?:fix|implement|build|add|change|update|create|refactor|investigate|debug|review|test|run|remove|migrate|write|port|make|work on|look into)\b/iu
const explicitWorkRequest =
  /\b(?:please|could you|can you|would you|go ahead and)\s+(?:fix|implement|build|add|change|update|create|refactor|investigate|debug|review|test|run|remove|migrate|write|port|work on|look into)\b/iu

const keywordDecision = (text: string): ReplyRouteResult => {
  const normalized = text.trim()
  const startsWithWorkVerb = workRequest.test(normalized)
  const asksForWork = explicitWorkRequest.test(normalized)
  return {
    route: startsWithWorkVerb || asksForWork ? 'thread' : 'reply',
    confidence: startsWithWorkVerb || asksForWork ? 0.8 : 0.6,
    source: 'keywords',
  }
}

export class ReplyRouting {
  static keywords(text: string): ReplyRouteResult {
    return keywordDecision(text)
  }

  static async classify(input: {
    readonly text: string
    readonly jev?: ((request: { readonly question: TriageQuestion; readonly text: string }) => Promise<number>) | undefined
    readonly threshold?: number | undefined
  }): Promise<ReplyRouteResult> {
    if (input.jev === undefined) return keywordDecision(input.text)
    try {
      const confidence = await input.jev({ question: threadWorthyQuestion, text: input.text })
      return {
        route: confidence >= (input.threshold ?? 0.72) ? 'thread' : 'reply',
        confidence,
        source: 'jev',
      }
    } catch {
      return keywordDecision(input.text)
    }
  }
}
