# Use standard Node image (Debian) for maximum compatibility with native modules (sharp, bcrypt)
FROM node:20

# Install build tools just in case (though node:20 has many)
RUN apt-get update -y && apt-get install -y openssl python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies IGNORING scripts to prevent 'prisma generate' from running before schema is copied
RUN npm install --ignore-scripts

# Copy the rest of the application (including prisma/schema.prisma)
COPY . .

# Generate Prisma Client (ensure it's fresh)
RUN npx prisma generate

# Build backend
RUN npm run build

EXPOSE 4000

CMD ["npm", "run", "start"]
