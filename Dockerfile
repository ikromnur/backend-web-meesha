# Use Debian-based image instead of Alpine for better compatibility with native modules (bcrypt, sharp)
FROM node:20-slim

# Install OpenSSL (required for Prisma) and other build tools
RUN apt-get update -y && apt-get install -y openssl python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build backend
RUN npm run build

EXPOSE 4000

CMD ["npm", "run", "start"]
