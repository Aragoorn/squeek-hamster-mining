/** Sign-in and per-action signature messages, plus claim voucher signing. */
import { recoverMessageAddress, type Address } from 'viem'
import type { PrivateKeyAccount } from 'viem/accounts'
import { SEPOLIA_CHAIN_ID } from './config'
import { ApiError, asInt, asSignature } from './security'

export function loginMessage(address: string, nonce: string, issuedAtIso: string): string {
  return [
    'Hamster Gems wants you to sign in.',
    `Address: ${address.toLowerCase()}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAtIso}`,
    `Chain ID: ${SEPOLIA_CHAIN_ID}`,
    'This signature costs no gas and never moves funds.',
  ].join('\n')
}

export function actionMessage(address: string, action: string, details: string, nonce: number): string {
  return [
    'Hamster Gems action',
    `Action: ${action}`,
    `Details: ${details}`,
    `Address: ${address.toLowerCase()}`,
    `Nonce: ${nonce}`,
    `Chain ID: ${SEPOLIA_CHAIN_ID}`,
  ].join('\n')
}

export async function recoverSigner(message: string, signature: `0x${string}`): Promise<string> {
  try {
    return (await recoverMessageAddress({ message, signature })).toLowerCase()
  } catch {
    throw new ApiError(401, 'BAD_SIGNATURE', 'That signature could not be verified.')
  }
}

/** Verifies a signed high-value action. Returns the nonce the caller must still match against the database. */
export async function verifyAction(
  address: string,
  action: string,
  details: string,
  nonceInput: unknown,
  signatureInput: unknown,
): Promise<number> {
  const nonce = asInt(nonceInput, 'nonce', 0, 1_000_000_000)
  const signature = asSignature(signatureInput)
  const recovered = await recoverSigner(actionMessage(address, action, details, nonce), signature)
  if (recovered !== address.toLowerCase()) {
    throw new ApiError(401, 'BAD_SIGNATURE', 'The signature does not match your wallet.')
  }
  return nonce
}

export interface VoucherParams {
  signer: PrivateKeyAccount
  hub: Address
  account: Address
  cumulative: bigint
  deadline: bigint
}

export const CLAIM_TYPES = {
  Claim: [
    { name: 'account', type: 'address' },
    { name: 'cumulative', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const

export async function signVoucher(p: VoucherParams): Promise<`0x${string}`> {
  return p.signer.signTypedData({
    domain: { name: 'HamsterGems', version: '1', chainId: SEPOLIA_CHAIN_ID, verifyingContract: p.hub },
    types: CLAIM_TYPES,
    primaryType: 'Claim',
    message: { account: p.account, cumulative: p.cumulative, deadline: p.deadline },
  })
}
