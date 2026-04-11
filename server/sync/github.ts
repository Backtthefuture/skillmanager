/**
 * Minimal GitHub REST client. Only the calls sync actually needs.
 * Uses the built-in fetch (Node 20+).
 */

export interface RepoInfo {
  fullName: string
  defaultBranch: string
  private: boolean
  canPush: boolean
  htmlUrl: string
}

export type ValidationResult =
  | { ok: true; repo: RepoInfo }
  | { ok: false; reason: 'bad_token' | 'not_found' | 'no_push' | 'network' | 'unknown'; message: string }

const API_BASE = 'https://api.github.com'

function headers(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'skill-hub',
  }
}

export async function validateRepo(
  owner: string,
  name: string,
  token: string,
): Promise<ValidationResult> {
  const url = `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
  let res: Response
  try {
    res = await fetch(url, { headers: headers(token) })
  } catch (e: any) {
    return { ok: false, reason: 'network', message: e?.message || 'network error' }
  }

  if (res.status === 401) {
    return { ok: false, reason: 'bad_token', message: 'Token 无效或已过期' }
  }
  if (res.status === 404) {
    return {
      ok: false,
      reason: 'not_found',
      message: '仓库不存在,或 token 没有访问权限(检查仓库名与 token 的 repo scope)',
    }
  }
  if (!res.ok) {
    return { ok: false, reason: 'unknown', message: `GitHub API ${res.status}: ${await res.text()}` }
  }

  const data = (await res.json()) as any
  const canPush = Boolean(data?.permissions?.push)
  if (!canPush) {
    return {
      ok: false,
      reason: 'no_push',
      message: 'Token 有效,但对该仓库没有写权限。请使用带 repo scope(或 Fine-grained: Contents: Read & Write)的 token。',
    }
  }

  return {
    ok: true,
    repo: {
      fullName: data.full_name,
      defaultBranch: data.default_branch || 'main',
      private: Boolean(data.private),
      canPush: true,
      htmlUrl: data.html_url,
    },
  }
}
