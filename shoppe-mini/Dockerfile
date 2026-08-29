# Shoppe Mini API — image chỉ chứa NestJS đã build.
# Postgres chạy container/service riêng, không nằm trong file này.
#
# Build (đứng trong thư mục shoppe-mini):
#   docker build -t shoppe-api .
# Chạy (cần DATABASE_URL trỏ tới host Postgres, không dùng localhost nếu DB ở container khác):
#   docker run --rm -p 3001:3001 --env-file .env shoppe-api

# ---- Stage 1: cài dependency + compile TypeScript ----
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# bcrypt và Prisma engine cần toolchain + OpenSSL khi npm ci trên Linux
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy lockfile trước để Docker cache lớp npm khi chỉ sửa code
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN npm ci

COPY . .

# generate không kết nối DB; URL giả chỉ để prisma.config.ts không thiếu biến
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build"

RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

# ---- Stage 2: image chạy production (nhỏ hơn, không compiler) ----
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Artifact từ stage builder — không COPY source .ts
COPY --from=builder --chown=node:node /app/package.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/generated ./generated
COPY --from=builder --chown=node:node /app/prisma ./prisma

USER node

EXPOSE 3001

# Khớp script start:prod trong package.json
CMD ["node", "dist/src/main.js"]
