# Pai Gow Poker — Multiplayer

Real-time multiplayer Pai Gow Poker built with Node.js, Express, and Socket.io.

## Features
- 2–7 players, real-time via WebSockets
- Each player sees only their own cards during hand-setting
- Rotating banker, even-money payouts (no commission)
- Bonus bet side game with custom payouts
- Buy-in during session, house bonus ledger, stats

## Local Development

```bash
npm install
npm start
# Visit http://localhost:3000
```

## Deploy to Railway

1. Push this repo to GitHub
2. Go to railway.app → New Project → Deploy from GitHub repo
3. Select this repo — Railway auto-detects Node.js
4. Railway will assign a public URL automatically

## How to Play

1. **Host** opens the URL, enters name, sets chip counts & bonus payouts, clicks **Create Room**
2. Host shares the 4-letter room code with friends
3. **Other players** open the URL, click **Join a Game**, enter name + code
4. Host clicks **Start Game** when everyone is in
5. Each player bets on their own screen, host deals
6. Each player privately sets their own hand
7. Hands auto-reveal when everyone is set
8. Host clicks **Next Round** to continue
