FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
# Public contract address, baked into the web build. Override with --build-arg.
ARG VITE_GEM_HUB_ADDRESS=0x648066e35b1d50e35d3bfd9ffef8dfb9c5b62c5c
ENV VITE_GEM_HUB_ADDRESS=$VITE_GEM_HUB_ADDRESS
RUN bun run build
ENV HOST=0.0.0.0 PORT=7860 GAME_DB_PATH=/app/data/game.db
RUN mkdir -p /app/data && chmod -R a+rwX /app/data
EXPOSE 7860
CMD ["bun", "run", "start"]
