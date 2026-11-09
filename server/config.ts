/** Server configuration. Secrets come from the environment only; nothing is hardcoded. */
import { getChain } from '../src/onchain-facts'

export const SEPOLIA_CHAIN_ID = 11155111
/** Chain key used by the sandbox RPC proxy. */
export const RPC_CHAIN_KEY = 'Ethereum_Sepolia'

export const SESSION_TTL_MS = 12 * 3600 * 1000
export const NONCE_TTL_MS = 5 * 60 * 1000
export const VOUCHER_TTL_SEC = 15 * 60
export const MAX_BODY_BYTES = 2048

export interface ServerEnv {
  port: number
  dbPath: string
  signerKey: `0x${string}` | undefined
  hubAddress: `0x${string}` | undefined
  rpcUrl: string
  trustProxy: boolean
}

export function resolveRpcUrl(env: Record<string, string | undefined> = process.env): string {
  const direct = env['RPC_URL_' + RPC_CHAIN_KEY]
  if (direct) return direct
  const chains = (env.RPC_PROXY_CHAINS ?? '').split(',')
  if (env.RPC_PROXY_BASE_URL && env.RPC_PROXY_TOKEN && chains.includes(RPC_CHAIN_KEY)) {
    return `${env.RPC_PROXY_BASE_URL}/api/rpc/${RPC_CHAIN_KEY}?_rpc_token=${env.RPC_PROXY_TOKEN}`
  }
  const fallback = getChain(SEPOLIA_CHAIN_ID)?.rpcUrls[0]
  if (!fallback) throw new Error('No RPC URL available for Sepolia')
  return fallback
}

const asHex = (v: string | undefined): `0x${string}` | undefined => (v && /^0x[0-9a-fA-F]+$/.test(v) ? (v as `0x${string}`) : undefined)

export function loadEnv(env: Record<string, string | undefined> = process.env): ServerEnv {
  return {
    port: Number(env.GAME_SERVER_PORT ?? 3001),
    dbPath: env.GAME_DB_PATH ?? 'data/game.db',
    signerKey: asHex(env.GAME_SIGNER_PRIVATE_KEY),
    hubAddress: asHex(env.VITE_GEM_HUB_ADDRESS),
    rpcUrl: resolveRpcUrl(env),
    trustProxy: env.TRUST_PROXY !== '0',
  }
}
