/** Which project a new capture starts with, and what it remembers for the next one. */
export class CaptureProject {
  /** An active header filter wins, then the project of the previous capture while remembering is on. */
  static initial(props: { readonly filter: string | null; readonly remembered: string | null; readonly reuse: boolean }): string | null {
    return props.filter ?? (props.reuse ? props.remembered : null)
  }

  /** After a send the box keeps the project it just used, or falls back to the scope the header still shows. */
  static next(props: { readonly sent: string | null; readonly filter: string | null; readonly reuse: boolean }): string | null {
    return props.reuse ? props.sent : props.filter
  }

  static remembered(props: { readonly sent: string | null; readonly reuse: boolean }): string | null {
    return props.reuse ? props.sent : null
  }
}
