FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json .
RUN npm ci

COPY . ./
RUN npm run build

FROM nginx:1.29-alpine

RUN rm -rf /etc/nginx/conf.d/default.conf
COPY ./nginx/default.conf /etc/nginx/conf.d/default.conf

COPY --from=builder /app/dist /usr/share/nginx/html

COPY ./nginx/env.sh /docker-entrypoint.d/40-env.sh
RUN sed -i 's/\r$//' /docker-entrypoint.d/40-env.sh \
    && chmod +x /docker-entrypoint.d/40-env.sh

WORKDIR /usr/share/nginx/html

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
