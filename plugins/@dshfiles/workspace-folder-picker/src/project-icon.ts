/**
 * A project's icon, resolved on the Host once and cached: the icon the repository declares in `dsh.project.json`, then a
 * short candidate list of conventional paths, then a monogram from the folder name. The client never scans a checkout.
 */
import { Effect, FileSystem, Option, Path } from 'effect'
import { loadProjectConfig, PROJECT_CONFIG_FILE } from './project-config.js'

/** Where a repository usually keeps an icon, most specific first. */
export const PROJECT_ICON_CANDIDATES: readonly string[] = [
  'assets/icon.svg',
  'assets/icon.png',
  'public/favicon.svg',
  'public/favicon.png',
  'app/icon.svg',
  'favicon.svg',
  'favicon.png',
  'favicon.ico',
  'icon.svg',
  'logo.svg',
  'logo.png',
  '.dsh/icon.svg',
]

/** A data URL larger than this is a photograph, not a project mark: the monogram is steadier than a 2 MB payload. */
export const MAX_PROJECT_ICON_BYTES = 64 * 1024

/** Positive results are stable content; a miss is re-checked sooner because the repository may still be gaining one. */
export const PROJECT_ICON_TTL_MS = 15 * 60_000
export const PROJECT_ICON_MISS_TTL_MS = 60_000

export type ProjectIconMediaType = 'image/svg+xml' | 'image/png' | 'image/jpeg' | 'image/webp' | 'image/x-icon'

export interface ResolvedProjectIcon {
  /** `image` renders the bytes; `monogram` renders the initials. */
  readonly kind: 'image' | 'monogram'
  /** `data:<media>;base64,…` for an image, and the initials themselves for a monogram. */
  readonly value: string
  readonly mediaType: ProjectIconMediaType | null
  /** The workspace-relative path the image came from, or `monogram`. */
  readonly source: string
}

/** One cache per Host: a project's icon is derived from files that change only when someone commits a new one. */
export interface ProjectIconCache {
  readonly read: (input: { readonly workspaceRoot: string; readonly title: string; readonly now: number }) => Effect.Effect<ResolvedProjectIcon>
}

const mediaTypeOf = (file: string): ProjectIconMediaType | null => {
  if (file.endsWith('.svg')) return 'image/svg+xml'
  if (file.endsWith('.png')) return 'image/png'
  if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg'
  if (file.endsWith('.webp')) return 'image/webp'
  if (file.endsWith('.ico')) return 'image/x-icon'
  return null
}

/** Two initials at most, from the first two words of the project name; one word keeps its first two letters. */
const monogramOf = (title: string): string => {
  const words = title
    .trim()
    .split(/[\s._-]+/u)
    .filter(word => word.length > 0)
  if (words.length === 0) return '?'
  const letters = words.length === 1 ? [...(words[0] ?? '')].slice(0, 2) : words.slice(0, 2).map(word => [...word][0] ?? '')
  return letters.join('').toLocaleUpperCase()
}

const monogramIcon = (title: string): ResolvedProjectIcon => ({ kind: 'monogram', value: monogramOf(title), mediaType: null, source: 'monogram' })

/** A project's icon helpers, grouped so the module exports one domain surface rather than a bag of functions. */
export class ProjectIcon {
  static monogram(title: string): string {
    return monogramOf(title)
  }

  /** The declared icon first, then the candidates; the first readable image under the size cap wins. */
  static resolve(input: {
    readonly fs: FileSystem.FileSystem
    readonly path: Path.Path
    readonly workspaceRoot: string
    readonly title: string
  }): Effect.Effect<ResolvedProjectIcon> {
    return Effect.gen(function* () {
      const declared = yield* loadProjectConfig(input.fs, input.workspaceRoot).pipe(
        Effect.orElseSucceed(() => ({ file: PROJECT_CONFIG_FILE, config: null, invalid: null })),
      )
      const declaredPath = declared.config?.iconPath
      const candidates =
        declaredPath === undefined ? PROJECT_ICON_CANDIDATES : [declaredPath, ...PROJECT_ICON_CANDIDATES.filter(candidate => candidate !== declaredPath)]
      for (const relativePath of candidates) {
        const mediaType = mediaTypeOf(relativePath)
        if (mediaType === null) continue
        const absolute = input.path.join(input.workspaceRoot, relativePath)
        const bytes = yield* input.fs.readFile(absolute).pipe(
          Effect.map(Option.some),
          Effect.orElseSucceed(() => Option.none<Uint8Array>()),
        )
        if (Option.isNone(bytes)) continue
        if (bytes.value.byteLength === 0 || bytes.value.byteLength > MAX_PROJECT_ICON_BYTES) continue
        return {
          kind: 'image',
          value: `data:${mediaType};base64,${Buffer.from(bytes.value).toString('base64')}`,
          mediaType,
          source: relativePath,
        } satisfies ResolvedProjectIcon
      }
      return monogramIcon(input.title)
    })
  }

  static cache(input: { readonly fs: FileSystem.FileSystem; readonly path: Path.Path }): Effect.Effect<ProjectIconCache> {
    return Effect.sync(() => {
      const entries = new Map<string, { readonly at: number; readonly icon: ResolvedProjectIcon }>()
      return {
        read: ({ workspaceRoot, title, now }) => {
          const cached = entries.get(workspaceRoot)
          const ttl = cached?.icon.kind === 'image' ? PROJECT_ICON_TTL_MS : PROJECT_ICON_MISS_TTL_MS
          if (cached !== undefined && now - cached.at < ttl) return Effect.succeed(cached.icon)
          return ProjectIcon.resolve({ fs: input.fs, path: input.path, workspaceRoot, title }).pipe(
            Effect.tap(icon =>
              Effect.sync(() => {
                entries.set(workspaceRoot, { at: now, icon })
              }),
            ),
          )
        },
      }
    })
  }
}
