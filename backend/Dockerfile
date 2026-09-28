FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache ca-certificates \
	&& wget -qO /etc/ssl/certs/aws-rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
	&& update-ca-certificates

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=4000
EXPOSE 4000

CMD ["npm", "start"]
