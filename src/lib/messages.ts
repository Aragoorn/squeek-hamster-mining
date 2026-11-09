/** Must stay byte-identical to `actionMessage` in server/auth.ts (covered by a test). */
export const GAME_CHAIN_ID = 11155111

export function actionMessage(address: string, action: string, details: string, nonce: number): string {
  return [
    'Hamster Gems action',
    `Action: ${action}`,
    `Details: ${details}`,
    `Address: ${address.toLowerCase()}`,
    `Nonce: ${nonce}`,
    `Chain ID: ${GAME_CHAIN_ID}`,
  ].join('\n')
}
