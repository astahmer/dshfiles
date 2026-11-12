export const redactSecrets = (text: string): string =>
  text
    .replace(/([?&#]token=)[^&\s"']*/gi, '$1[redacted]')
    .replace(/("(?:[a-z_]*token|authorization|cookie|password|secret|api_?key)"\s*:\s*")(?:[^"\\]|\\.)*"/gi, '$1[redacted]"')
    .replace(/(authorization|cookie)\s*[:=]\s*(?:(?:bearer|basic|token)\s+)?[^\s,;"]+/gi, '$1=[redacted]')
