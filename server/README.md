# 👑 Royal Ludo — Live Multiplayer WebSocket Server

This directory contains the lightweight, production-ready WebSocket relay server for Royal Ludo. It enables players anywhere in the world to create and join 6-digit game rooms over **4G/5G mobile data, Wi-Fi, and the global Internet**.

---

## 🚀 1-Click / 5-Minute Free Deployment Guide

### Option A: Deploy on Render.com (Recommended & Free)
1. Push this project or the `/server` folder to a GitHub repository.
2. Go to [Render.com](https://render.com) and create a **New Web Service**.
3. Connect your GitHub repository and set:
   - **Root Directory**: `server`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
4. Click **Deploy**. Render will provide a free secure URL, e.g.:
   `https://ludo-server.onrender.com`
5. Your WebSocket URL is:
   `wss://ludo-server.onrender.com`

---

### Option B: Deploy on Railway.app
1. Go to [Railway.app](https://railway.app) -> **New Project** -> **Deploy from GitHub repo**.
2. Select the repository and the `/server` subdirectory.
3. Railway will auto-detect Node.js and assign a public domain with SSL:
   `wss://your-service.up.railway.app`

---

### Option C: Deploy on your own Linux VPS (Ubuntu / AWS / DigitalOcean)
```bash
# 1. Clone & install dependencies
cd ludo_game/server
npm install

# 2. Run with PM2 for 24/7 background uptime
npm install -g pm2
pm2 start server.js --name "ludo-game-server"
pm2 startup
pm2 save
```

If using Nginx with SSL (Let's Encrypt), add WebSocket proxying:
```nginx
location /ws/ {
    proxy_pass http://localhost:8080/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "Upgrade";
    proxy_set_header Host $host;
}
```

---

## 📱 Connecting your Flutter App to your Live Server

In your Flutter app, open [`lib/services/online_room_service.dart`](../lib/services/online_room_service.dart):

```dart
// Change this line to your live server's WebSocket URL:
static const String liveServerUrl = 'wss://your-ludo-server.onrender.com';
```

When `liveServerUrl` is set:
1. When a player taps **"Create Room"**, it creates the room on your live cloud server.
2. Anyone entering the 6-digit code on their phone (even on cellular data across different continents) will instantly connect and join the room!
3. If `liveServerUrl` is left blank (`''`), the app runs in local Wi-Fi / Hotspot / Instant-simulation mode.
