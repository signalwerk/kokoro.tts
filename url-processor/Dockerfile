FROM node:22-alpine

# Install ffmpeg for audio processing
RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
