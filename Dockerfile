FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
# Install dependencies
RUN npm ci
COPY . .
# Build backend
RUN npm run build
EXPOSE 4000
# Command untuk menjalankan production
CMD ["npm", "run", "start"]
