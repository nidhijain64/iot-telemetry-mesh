FROM node:24-alpine AS build
WORKDIR /app
ENV CYPRESS_INSTALL_BINARY=0
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
COPY public ./public
ARG VITE_API_URL
ARG VITE_MQTT_WS_URL
ENV VITE_API_URL=$VITE_API_URL VITE_MQTT_WS_URL=$VITE_MQTT_WS_URL
RUN npm run build
FROM nginxinc/nginx-unprivileged:1.28-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
