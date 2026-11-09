# Hamster Gems

A hamster-themed gem mining game on Ethereum Sepolia. Deploy hamsters, mine and refine gems, swap them for HGEM tokens, stake HGEM for yield and a mining boost, and climb the leaderboard.

Built with [Arc Studio](https://studio.arc.io)

## What you can do

- Mine bronze gems by tapping and let Worker, Manager and Director hamsters mine bronze, silver and gold while you are away.
- Hire and upgrade hamsters, and watch your energy, level, hash power and multiplier.
- Refine lower gems into rarer ones, up to the Royal Gem.
- Swap gems for HGEM at a rate that falls as the community swaps more each day, with personal and global daily limits, then claim the HGEM to your wallet.
- Stake HGEM in four lock tiers for passive yield and a mining boost.
- Check in daily, finish quests, invite friends for a share of what they mine, and compare ranks.
- Install it as a mobile app (PWA).

## Tech stack

React 18, Vite, TypeScript, Tailwind CSS, wagmi and viem, Bun server with SQLite, Solidity 0.8.28 with Foundry.

## Development

Prerequisites: [Bun](https://bun.sh) and [Foundry](https://book.getfoundry.sh).
web: https://squeek-hamster-mining.netlify.app/
صث
```bash
bun install
bun run server   # game API on port 3001
bun run dev      # web app on port 5173, proxies /api to the game API
```

Scripts: `bun run check` (lint and typecheck), `bun run test` (game engine and API tests), `bun run contracts:build`, `bun run contracts:test`, `bun run test:all`.

### Environment variables

- `VITE_GEM_HUB_ADDRESS`: address of the deployed GemHub contract on Sepolia.
- `GAME_SIGNER_PRIVATE_KEY`: backend key that signs claim vouchers. Its address must match the contract's `signer`. Keep it secret and never commit it.
- `GAME_SERVER_PORT`: game API port (default 3001).
- `GAME_DB_PATH`: SQLite file (default `data/game.db`).
- `TRUST_PROXY`: set to `0` to ignore `x-forwarded-for` when rate limiting by IP.
- `RPC_URL_Ethereum_Sepolia`: your own Sepolia RPC URL for the server (recommended when deployed).
- `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS`: provided by Arc Studio, optional elsewhere.

### Production

`bun run build` then `bun run start` serves the built web app and the API from one process (set `HOST=0.0.0.0` and `PORT`). A `Dockerfile` is included; it listens on port 7860. Set `GAME_SIGNER_PRIVATE_KEY` as a secret, point `RPC_URL_Ethereum_Sepolia` at your own provider, and keep `GAME_DB_PATH` on persistent storage or player progress resets on restart. A static-only host cannot run the game, because the API needs a server.
