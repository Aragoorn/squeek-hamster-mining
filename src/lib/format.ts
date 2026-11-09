const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 })
const plain = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

export function formatNum(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return Math.abs(n) >= 100_000 ? compact.format(n) : plain.format(Math.floor(n * 100) / 100)
}

export function formatInt(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.floor(Number.isFinite(n) ? n : 0))
}

export const microToHgem = (micro: number): number => micro / 1_000_000

export function formatHgem(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value)
}

export function shortAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return 'now'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${Math.max(1, m)}m`
}
