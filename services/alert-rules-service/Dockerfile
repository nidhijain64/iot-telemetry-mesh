FROM node:20-alpine
WORKDIR /app

# npm ci installs exactly what package-lock.json pins, and fails if the two have
# drifted — npm install can quietly resolve different versions at build time.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Only the source, never the whole context. "COPY . ." would bake this service's
# .env — MONGO_URI and JWT_SECRET included — into an image layer, where it stays
# readable by anyone who can pull the image. Config comes in at runtime instead.
COPY src ./src

# node:alpine ships an unprivileged "node" user. Running as root inside a
# container is blast radius with no upside for a process that only serves HTTP.
USER node

EXPOSE 3004
CMD ["node", "src/index.js"]
