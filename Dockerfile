FROM node:20-alpine
WORKDIR /app

# Install build dependencies for bcrypt, sharp, etc.
RUN apk add --no-cache python3 make g++

COPY package*.json ./
# Install dependencies (use npm install instead of ci to be more lenient with lockfile)
RUN npm install

COPY . .

# Build backend
RUN npm run build
EXPOSE 4000
CMD ["npm", "run", "start"]
