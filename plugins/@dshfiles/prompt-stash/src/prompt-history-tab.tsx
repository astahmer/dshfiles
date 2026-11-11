import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@dshfiles/plugin-ui/components/ui/command'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { StarIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'
import { MAX_PROMPT_TEXT_LENGTH } from './library.js'
import { promptStashApi, type HistoryPrompt } from './library-api.js'

const HISTORY_ROWS = 50

export const promptHistoryKeys = { search: (text: string) => ['prompt-stash', 'history', text] as const }

const emptyLine = (text: string): JSX.Element => <p className="dshx:px-3 dshx:py-4 dshx:text-center dshx:text-xs dshx:text-muted-foreground">{text}</p>

/** Every prompt the user sent across threads, searched on the Host; Enter inserts, the star saves it to the library. */
export const PromptHistoryTab = (props: {
  readonly active: boolean
  readonly insertDisabled: boolean
  readonly isSaved: (text: string) => boolean
  readonly canSave: boolean
  readonly onInsert: (text: string) => void
  readonly onSave: (text: string) => void
}): JSX.Element => {
  const api = useApi(promptStashApi)
  const [search, setSearch] = useState('')
  const text = useDebouncedValue({ value: search.trim(), delayMs: 200 })
  const history = useQuery({
    queryKey: promptHistoryKeys.search(text),
    queryFn: ({ signal }) => api.history(text.length === 0 ? { limit: HISTORY_ROWS } : { text, limit: HISTORY_ROWS }, { signal }),
    enabled: props.active,
    // A prompt sent a moment ago is indexed within seconds: refresh while the tab is open.
    staleTime: 0,
    refetchInterval: props.active ? 5_000 : false,
  })

  const prompts: readonly HistoryPrompt[] = history.data?.prompts ?? []
  const status = history.isError ? 'error' : (history.data?.status ?? 'loading')

  return (
    <Command className="dshx:rounded-none dshx:bg-transparent" shouldFilter={false}>
      <CommandInput placeholder="Search every prompt you sent" value={search} onValueChange={setSearch} autoFocus />
      <CommandList className="dshx:max-h-80 dshx:p-1" label="Prompt history">
        {status === 'loading' ? emptyLine('Searching sent prompts…') : null}
        {status === 'error' ? emptyLine('Prompt history could not be read. Reopen Prompts to try again; restart DSH if it keeps failing.') : null}
        {status === 'disabled' ? emptyLine('Prompt history is off. Turn on promptHistory in Settings › Plugins › Prompt Stash.') : null}
        {status === 'unavailable'
          ? emptyLine('Prompt history needs the Session Search plugin. Add @dshfiles/session-search to this profile and restart DSH.')
          : null}
        {status === 'ready' ? (
          <CommandEmpty className="dshx:py-4 dshx:text-center dshx:text-xs dshx:text-muted-foreground">
            {text.length === 0 ? 'No sent prompts yet.' : 'No sent prompt matches.'}
          </CommandEmpty>
        ) : null}
        {prompts.map(prompt => {
          const saved = props.isSaved(prompt.text)
          const savable = !saved && props.canSave && prompt.text.length <= MAX_PROMPT_TEXT_LENGTH
          return (
            <CommandItem
              key={`${prompt.sessionId}:${String(prompt.seq)}`}
              value={`${prompt.sessionId}:${String(prompt.seq)}`}
              disabled={props.insertDisabled}
              onSelect={() => props.onInsert(prompt.text)}
              className="dshx:group/history dshx:items-start"
            >
              <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5">
                <span className="dshx:text-xs dshx:text-muted-foreground">{new Date(prompt.time).toLocaleString()}</span>
                <span className="dshx:line-clamp-2 dshx:w-full dshx:text-sm">{prompt.text.slice(0, 240)}</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className={cn(
                  'dshx:flex-none dshx:pointer-coarse:size-11',
                  saved ? 'dshx:text-warning' : 'dshx:text-muted-foreground dshx:hover:text-foreground',
                )}
                aria-label={saved ? 'Saved to prompts' : 'Save to prompts'}
                aria-pressed={saved}
                disabled={!savable}
                onKeyDown={event => event.stopPropagation()}
                onClick={event => {
                  event.stopPropagation()
                  props.onSave(prompt.text)
                }}
              >
                <StarIcon className={saved ? 'dshx:fill-current' : undefined} />
              </Button>
            </CommandItem>
          )
        })}
      </CommandList>
    </Command>
  )
}
