export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly retryAfter?: number
  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
  }
}

export async function apiRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  options: { token?: string | null; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.token) headers.authorization = `Bearer ${options.token}`
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(0, 'NETWORK', 'Cannot reach the game server. Check your connection.')
  }
  let json: Record<string, unknown> | null = null
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    json = null
  }
  if (!res.ok || !json || json.ok === false) {
    const retry = Number(res.headers.get('retry-after') ?? '') || undefined
    throw new ApiError(
      res.status,
      typeof json?.code === 'string' ? json.code : 'HTTP_' + res.status,
      typeof json?.error === 'string' ? json.error : 'Something went wrong. Please try again.',
      retry,
    )
  }
  return json as T
}

/** Turns any thrown value into a short message fit for a toast. */
export function friendlyError(err: unknown): string {
  if (err instanceof ApiError) return err.message
  const message = err instanceof Error ? err.message : String(err)
  const lower = message.toLowerCase()
  if (lower.includes('user rejected') || lower.includes('user denied')) return 'Request cancelled in your wallet.'
  if (lower.includes('insufficient funds')) return 'Not enough Sepolia ETH for gas.'
  if (lower.includes('capexceeded')) return 'The daily global claim cap is full. Try again after 00:00 UTC.'
  if (lower.includes('nothingtoclaim')) return 'Nothing new to claim.'
  if (lower.includes('expired')) return 'That claim expired. Request a new one.'
  if (lower.includes('locked')) return 'This position is still locked.'
  if (lower.includes('enforcedpause')) return 'The contract is paused by its owner.'
  if (lower.includes('network') || lower.includes('timeout')) return 'Network issue. Please try again.'
  return 'Something went wrong. Please try again.'
}
