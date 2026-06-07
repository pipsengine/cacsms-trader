# Build the Next.js app on the host first: npm run build
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && mkdir -p data \
  && chown -R nextjs:nodejs data

COPY public ./public
COPY .next/standalone ./
RUN rm -f .env .env.local .env.production .env.development
COPY .next/static ./.next/static
COPY mt5 ./mt5
COPY scripts/docker-start.mjs scripts/docker-start.mjs
COPY scripts/apply-all-migrations.mjs scripts/apply-all-migrations.mjs
COPY scripts/sync-bridge-secret.mjs scripts/sync-bridge-secret.mjs
COPY database ./database

RUN chown -R nextjs:nodejs /app/data

USER nextjs
EXPOSE 3000 8787
CMD ["node", "scripts/docker-start.mjs"]
