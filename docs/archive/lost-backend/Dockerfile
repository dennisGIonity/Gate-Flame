FROM node:20-alpine

# Install hardware dependencies for networkScanner and securityAPI
# arp-scan and nmap for network discovery, speedtest-cli can be installed via npm or apk if available
RUN apk add --no-cache arp-scan nmap

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy backend files
COPY server.js telemetryService.js networkScanner.js containerManager.js securityAPI.js settings.json ./

EXPOSE 3001

CMD ["node", "server.js"]
