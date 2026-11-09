# [App Name]

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

[Brief description of what the app does and its primary use case]

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## Share links

- Starter apps already ship `getShareBase`, `buildShareLink` and `installShareSync` in `src/lib/share.ts`; import them instead of rewriting them.
- Keep shareable state in the URL path or query, not in the `#fragment`.
- Never put a secret (private key, claim secret, seed phrase, session token, API key) in the URL path or query, encoded or not: every in-app path and query is mirrored to the visitor's studio.arc.io address bar and browser history and reaches servers. A bearer claim secret goes only in the `#fragment` appended to the share link (`` `${await buildShareLink('/claim')}#${secret}` ``) and is read from `location.hash` on load. A link to the app's own share URL shown inside the app must be copy-only or open in a new tab with `target="_blank" rel="noopener noreferrer"`.
- Build every link a user copies or sends with `buildShareLink()` from `src/lib/share.ts`.
- Keep the `installShareSync()` call in `src/main.tsx` when editing it; it keeps the Studio address bar in step with in-app navigation.
- Navigate inside the app with relative links.

## To Run

```bash
bun install
bun run dev
```


---

## Project notes (Hamster Gems)

- App: hamster gem mining game on Ethereum Sepolia (chain 11155111). Dark Arc theme.
- Contract: `contracts/GemHub.sol` (ERC20 HGEM + EIP-712 cumulative claims + staking in one size-optimized contract; Sepolia deploy gas forces about 5 KB runtime; `via_ir` and `optimizer_runs = 1` are set in `foundry.toml` for that reason).
- Deployed GemHub (Sepolia): `0x648066e35b1d50e35d3bfd9ffef8dfb9c5b62c5c`. Owner: `0xA1C6808b8f08D091e2826C9640Be302a310655E1`. Claim signer: `0x0A8E2F3Ea6551B8055C6F545F1057332C3C4bbB2` (backend key in `.env` as `GAME_SIGNER_PRIVATE_KEY`; the owner can rotate it with `setSigner`). An earlier deployment without admin events exists at `0x74601629a494ca2fc08dc1da3c7ac3cbb9517084` and is unused.
- The mining boost from staking is enforced by the backend (reads `positions()` onchain); the contract only stores positions.
- Game engine: `src/game/` (pure, shared). Server: `server/` (Bun + SQLite, port 3001, proxied at `/api`). Tests: `bun test src server`, `forge test`.
- Type checking is split: `tsconfig.json` (browser) and `tsconfig.server.json` (Bun types).
