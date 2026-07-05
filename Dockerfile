FROM node:22.18.0-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

RUN corepack enable

FROM base AS deps

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build

COPY . .
RUN pnpm prisma generate
RUN pnpm build

FROM base AS runner

ENV NODE_ENV=production

RUN addgroup -S nextjs -g 1001 && adduser -S nextjs -u 1001 -G nextjs

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules

USER nextjs

EXPOSE 3000

CMD ["sh", "-c", "pnpm start -- --hostname 0.0.0.0 --port 3000"]
