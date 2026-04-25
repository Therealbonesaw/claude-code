# Hot Potato

A pass-the-turn web app for board games — in person around a table, or remote
over webcam. Each player opens the app on their phone and joins the same room.
When it's your turn, your phone screen turns green and vibrates. Tap to pass to
the next player.

No app store install, no sound effects, no kid-game theming. It's a turn
tracker.

## Run locally

```sh
npm install
npm start
```

Open `http://localhost:3000` on each player's phone (they need to be on the
same network as the server, or use a tunneling tool like `cloudflared` /
`ngrok` to expose it).

To use a different port: `PORT=8080 npm start`.

## How it works

- One player taps **Create room** and gets a 4-character code.
- Other players tap **Join room**, enter the code, and join.
- The host (room creator) taps **Start game** once everyone is in.
- The current player's phone is full-screen green with a big PASS button.
  Everyone else sees a gray screen showing whose turn it is.
- Tap PASS to advance to the next player in join order.
- The host can **Skip** the current player (useful if someone's phone is dead)
  or **End game** to return to the lobby.

Player order is locked once the game starts. Players can refresh or briefly
disconnect — they reclaim their slot automatically via a stored player ID.

## Deploy

Any host that runs a Node process and supports WebSockets works. The server
listens on `process.env.PORT`.

- **Render / Railway / Fly.io**: point at this directory, set start command to
  `npm start`, no extra config needed.
- **Self-host**: `node server.js` behind a reverse proxy that forwards
  WebSocket upgrades (nginx `proxy_set_header Upgrade ...`).

## Architecture

- `server.js` — Express for static assets + a `ws` WebSocket server. Rooms
  are kept in memory; empty rooms are GC'd after one hour.
- `public/index.html`, `public/app.js`, `public/style.css` — vanilla JS client,
  no build step.

Wire protocol (all JSON over WebSocket):

| Client → server   | Fields                          |
| ----------------- | ------------------------------- |
| `create_room`     | `name`                          |
| `join_room`       | `code`, `name`, `playerId?`     |
| `start_game`      | host only                       |
| `pass`            | only valid for current player   |
| `skip`            | host only                       |
| `reset`           | host only, ends game            |
| `rename`          | `name`                          |

Server broadcasts a single `state` message to every player on every change:

```json
{
  "type": "state",
  "code": "ABCD",
  "hostId": "...",
  "started": true,
  "currentIndex": 1,
  "players": [{ "id": "...", "name": "Alice", "connected": true }],
  "you": "..."
}
```
