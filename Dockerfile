FROM node:22-alpine AS build
WORKDIR /app

COPY package.json tsconfig.json ./
COPY src ./src
RUN npm install --no-audit --no-fund \
  && npm run build \
  && npm cache clean --force

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000
WORKDIR /app

COPY --from=build /app/dist ./dist
COPY package.json LICENSE ./
COPY service ./service

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "service/gateway-service.mjs"]
