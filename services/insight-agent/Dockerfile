FROM node:20-alpine
WORKDIR /app

# npm ci installs exactly what package-lock.json pins, and fails if the two have
# drifted — npm install can quietly resolve different versions at build time.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Only the source, never the whole context. "COPY . ." would bake this service's
# .env — MONGO_URI and GROQ_API_KEY included — into an image layer.
COPY src ./src

USER node

EXPOSE 3006
CMD ["node", "src/index.js"]
