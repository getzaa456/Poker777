FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG VITE_API_BASE=""
ENV VITE_API_BASE=$VITE_API_BASE

RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

ENV NGINX_ENVSUBST_FILTER=^(BACKEND_INTERNAL_DNS|NGINX_RESOLVER)$

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
