FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source only; inject credentials at runtime.
COPY src ./src

USER node

EXPOSE 3004
CMD ["node", "src/index.js"]
