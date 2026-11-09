/** Rate limiting, strict input validation and response helpers. */
import { MAX_BODY_BYTES } from './config'

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

interface Bucket {
  tokens: number
  at: number
}

/** In-memory token bucket limiter. Keys are scoped by the caller (ip, address, route). */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>()
  private lastSweep = 0
  constructor(private readonly maxKeys = 50_000) {}

  /** Returns seconds to wait when limited, or 0 when the request may proceed. */
  take(key: string, capacity: number, refillPerSec: number, now: number): number {
    this.sweep(now)
    const bucket = this.buckets.get(key) ?? { tokens: capacity, at: now }
    const elapsed = Math.max(0, (now - bucket.at) / 1000)
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerSec)
    bucket.at = now
    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket)
      return Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerSec))
    }
    bucket.tokens -= 1
    this.buckets.set(key, bucket)
    return 0
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000 && this.buckets.size < this.maxKeys) return
    this.lastSweep = now
    for (const [key, b] of this.buckets) {
      if (now - b.at > 10 * 60_000) this.buckets.delete(key)
    }
    if (this.buckets.size >= this.maxKeys) this.buckets.clear()
  }
}

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
export const SIGNATURE_RE = /^0x[0-9a-fA-F]{130}$/
export const REF_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/

export function normalizeAddress(value: unknown): `0x${string}` {
  if (typeof value !== 'string' || !ADDRESS_RE.test(value)) {
    throw new ApiError(400, 'BAD_ADDRESS', 'Invalid wallet address.')
  }
  return value.toLowerCase() as `0x${string}`
}

export function asSignature(value: unknown): `0x${string}` {
  if (typeof value !== 'string' || !SIGNATURE_RE.test(value)) {
    throw new ApiError(400, 'BAD_SIGNATURE', 'Invalid signature format.')
  }
  return value as `0x${string}`
}

export function asInt(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new ApiError(400, 'BAD_INPUT', `${field} must be a whole number from ${min} to ${max}.`)
  }
  return value
}

export function asEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new ApiError(400, 'BAD_INPUT', `${field} is not valid.`)
  }
  return value as T
}

/** Reads and validates a small JSON object body. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get('content-type') ?? ''
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'BAD_CONTENT_TYPE', 'Send JSON.')
  }
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) throw new ApiError(413, 'TOO_LARGE', 'Request body too large.')
  const text = await req.text()
  if (text.length > MAX_BODY_BYTES) throw new ApiError(413, 'TOO_LARGE', 'Request body too large.')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ApiError(400, 'BAD_JSON', 'Malformed JSON.')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(400, 'BAD_JSON', 'Expected a JSON object.')
  }
  return parsed as Record<string, unknown>
}

const SECURITY_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'SAMEORIGIN',
}

export function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...SECURITY_HEADERS, ...extra } })
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    const extra: Record<string, string> = err.retryAfter ? { 'retry-after': String(err.retryAfter) } : {}
    return jsonResponse({ ok: false, code: err.code, error: err.message }, err.status, extra)
  }
  console.error('[server] unexpected error', err instanceof Error ? err.message : err)
  return jsonResponse({ ok: false, code: 'INTERNAL', error: 'Something went wrong on our side.' }, 500)
}
