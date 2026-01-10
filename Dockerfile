# Use standard Node image (Debian) for maximum compatibility with native modules (sharp, bcrypt)
FROM node:20

# Install build tools just in case (though node:20 has many)
RUN apt-get update -y && apt-get install -y openssl python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json ./

# Copy prisma schema early so postinstall (prisma generate) works
COPY prisma ./prisma/

# Install dependencies (Delete lockfile to force Linux resolution, and rebuild native modules)
RUN npm install && npm rebuild bcrypt sharp

# Copy the rest of the application
COPY . .

# Generate Prisma Client (ensure it's fresh)
RUN npx prisma@6.7.0 generate

# Update sharp to latest to fix TS issues
RUN npm install sharp@latest

# Build backend
RUN npm run build

EXPOSE 4000

CMD ["npm", "run", "start"]
