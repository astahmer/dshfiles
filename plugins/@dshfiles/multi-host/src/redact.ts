export const redactSecrets = (text: string): string =>
  text.replace(/([?&#]token=)[^&\s"']*/gi, '$1[redacted]').replace(/(authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
