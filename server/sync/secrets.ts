/**
 * Conservative secret & absolute-path scanner. Runs over files that are about
 * to be uploaded. Reports findings but never auto-redacts — that's too risky.
 */

export type Severity = 'danger' | 'warn'

export interface Finding {
  file: string          // vault-relative path
  line: number          // 1-based
  column: number        // 1-based
  match: string         // the matched snippet (truncated to 80 chars)
  kind: string          // pattern name
  severity: Severity
}

interface Pattern {
  kind: string
  regex: RegExp
  severity: Severity
}

// Each pattern runs over an entire line. Keep them anchored enough to avoid
// false positives on Chinese text / URLs / random base64 snippets.
const PATTERNS: Pattern[] = [
  // --- high severity: clearly credentials ---
  // Negative lookahead for `sk-ant-` so anthropic keys get their own, more specific kind below
  { kind: 'openai-key',         regex: /\bsk-(?!ant-)[a-zA-Z0-9_-]{20,}\b/g,    severity: 'danger' },
  { kind: 'github-pat-classic', regex: /\bghp_[a-zA-Z0-9]{30,}\b/g,             severity: 'danger' },
  { kind: 'github-pat-fine',    regex: /\bgithub_pat_[a-zA-Z0-9_]{30,}\b/g,     severity: 'danger' },
  { kind: 'github-oauth',       regex: /\bgho_[a-zA-Z0-9]{30,}\b/g,             severity: 'danger' },
  { kind: 'aws-access-key',     regex: /\bAKIA[0-9A-Z]{16}\b/g,                 severity: 'danger' },
  { kind: 'anthropic-key',      regex: /\bsk-ant-[a-zA-Z0-9_-]{20,}\b/g,        severity: 'danger' },
  { kind: 'slack-token',        regex: /\bxox[baprs]-[a-zA-Z0-9-]{10,}\b/g,     severity: 'danger' },
  { kind: 'google-api-key',     regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,            severity: 'danger' },
  { kind: 'private-key-header', regex: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |ENCRYPTED )?PRIVATE KEY-----/g, severity: 'danger' },
  { kind: 'jwt',                regex: /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g, severity: 'danger' },

  // --- medium severity: suspicious shapes / machine-specific paths ---
  { kind: 'macos-home-path',    regex: /\/Users\/[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*/g, severity: 'warn' },
  { kind: 'linux-home-path',    regex: /\/home\/[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*/g,  severity: 'warn' },
  { kind: 'windows-home-path',  regex: /[Cc]:\\Users\\[a-zA-Z0-9._-]+/g,                   severity: 'warn' },
  { kind: 'bearer-header',      regex: /\bBearer\s+[a-zA-Z0-9._-]{20,}\b/g,              severity: 'warn' },
]

// Only scan files that look like text/source. Skip binaries by extension.
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico',
  '.mp4', '.mov', '.avi', '.webm', '.mp3', '.wav',
  '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z',
  '.pdf', '.db', '.sqlite', '.sqlite3',
  '.woff', '.woff2', '.ttf', '.eot',
  '.pyc', '.so', '.dylib', '.dll', '.exe',
])

export function isScannableFile(relPath: string): boolean {
  const lower = relPath.toLowerCase()
  for (const ext of BINARY_EXTS) {
    if (lower.endsWith(ext)) return false
  }
  return true
}

export function scanContent(relPath: string, content: string): Finding[] {
  if (!isScannableFile(relPath)) return []

  const findings: Finding[] = []
  const lines = content.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const pat of PATTERNS) {
      // Reset regex state for /g patterns
      pat.regex.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = pat.regex.exec(line)) !== null) {
        findings.push({
          file: relPath,
          line: i + 1,
          column: m.index + 1,
          match: truncate(m[0], 80),
          kind: pat.kind,
          severity: pat.severity,
        })
        if (m.index === pat.regex.lastIndex) pat.regex.lastIndex++
      }
    }
  }

  return findings
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

export interface ScanSummary {
  totalFindings: number
  danger: number
  warn: number
  findings: Finding[]
}

export function summarize(findings: Finding[]): ScanSummary {
  return {
    totalFindings: findings.length,
    danger: findings.filter((f) => f.severity === 'danger').length,
    warn: findings.filter((f) => f.severity === 'warn').length,
    findings,
  }
}
