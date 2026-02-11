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

# Open port 7860 for Hugging Face
ENV PORT=7860
EXPOSE 7860

# Start everything
CMD ["/app/start.sh"]
