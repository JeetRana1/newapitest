FROM node:20-alpine

# Install Tor and create a directory for it
RUN apk add --no-cache tor

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Create a start script to run both Tor and the Node app
RUN echo "#!/bin/sh" > /app/start.sh && \
    echo "tor &" >> /app/start.sh && \
    echo "npm start" >> /app/start.sh && \
    chmod +x /app/start.sh

# Open port 8000 for Koyeb health checks
ENV PORT=8000
EXPOSE 8000

# Start everything
CMD ["/app/start.sh"]
