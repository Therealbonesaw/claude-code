(() => {
  const STORAGE_KEY = 'hot-potato:session';

  const els = {
    body: document.body,
    lobby: document.getElementById('lobby'),
    room: document.getElementById('room'),
    game: document.getElementById('game'),
    name: document.getElementById('name'),
    code: document.getElementById('code'),
    createBtn: document.getElementById('create-btn'),
    joinBtn: document.getElementById('join-btn'),
    lobbyError: document.getElementById('lobby-error'),
    roomCode: document.getElementById('room-code'),
    leaveBtn: document.getElementById('leave-btn'),
    playerList: document.getElementById('player-list'),
    playerCount: document.getElementById('player-count'),
    waitingText: document.getElementById('waiting-text'),
    startBtn: document.getElementById('start-btn'),
    turnLabel: document.getElementById('turn-label'),
    turnName: document.getElementById('turn-name'),
    nextName: document.getElementById('next-name'),
    passBtn: document.getElementById('pass-btn'),
    skipBtn: document.getElementById('skip-btn'),
    resetBtn: document.getElementById('reset-btn'),
    connection: document.getElementById('connection'),
    themeColor: document.getElementById('theme-color'),
  };

  let ws = null;
  let state = null;
  let session = loadSession();
  let wakeLock = null;
  let lastWasMyTurn = false;
  let reconnectTimer = null;
  let reconnectDelay = 500;

  const savedName = session?.name || localStorage.getItem('hot-potato:name') || '';
  if (savedName) els.name.value = savedName;

  function loadSession() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch {
      return null;
    }
  }

  function saveSession(next) {
    session = next;
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_KEY);
  }

  function setScreen(name) {
    els.body.dataset.screen = name;
    els.lobby.hidden = name !== 'lobby';
    els.room.hidden = name !== 'room';
    els.game.hidden = name !== 'game';
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  function connect(onOpen) {
    clearTimeout(reconnectTimer);
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.addEventListener('open', () => {
      els.connection.hidden = true;
      reconnectDelay = 500;
      if (onOpen) onOpen();
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      handleMessage(msg);
    });
    ws.addEventListener('close', () => {
      if (!session) return;
      els.connection.hidden = false;
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, 8000);
        connect(() => {
          send({
            type: 'join_room',
            code: session.code,
            playerId: session.playerId,
            name: session.name,
          });
        });
      }, reconnectDelay);
    });
    ws.addEventListener('error', () => { try { ws.close(); } catch {} });
  }

  function handleMessage(msg) {
    if (msg.type === 'error') {
      showError(msg.message);
      if (msg.message === 'Room not found' || msg.message === 'Game already started') {
        saveSession(null);
        setScreen('lobby');
      }
      return;
    }
    if (msg.type === 'state') {
      state = msg;
      saveSession({ code: msg.code, playerId: msg.you, name: getMe()?.name || session?.name || '' });
      render();
    }
  }

  function getMe() {
    if (!state) return null;
    return state.players.find((p) => p.id === state.you) || null;
  }

  function getCurrent() {
    if (!state || !state.started) return null;
    return state.players[state.currentIndex] || null;
  }

  function getNext() {
    if (!state || !state.started || state.players.length === 0) return null;
    const idx = (state.currentIndex + 1) % state.players.length;
    return state.players[idx];
  }

  function isHost() {
    return state && state.you === state.hostId;
  }

  function render() {
    if (!state) {
      setScreen('lobby');
      return;
    }
    els.roomCode.textContent = state.code;
    renderPlayers();

    if (!state.started) {
      setScreen('room');
      els.startBtn.hidden = !isHost();
      if (isHost()) {
        els.startBtn.disabled = state.players.length < 2;
        els.waitingText.textContent =
          state.players.length < 2
            ? 'Waiting for at least one more player.'
            : 'Tap start when everyone has joined.';
      } else {
        els.waitingText.textContent = 'Waiting for the host to start.';
      }
      els.body.dataset.turn = '';
      els.themeColor.setAttribute('content', '#111111');
      releaseWakeLock();
      lastWasMyTurn = false;
      return;
    }

    setScreen('game');
    const current = getCurrent();
    const next = getNext();
    const me = getMe();
    const myTurn = current && me && current.id === me.id;

    els.turnLabel.textContent = myTurn ? "It's your turn" : 'Current turn';
    els.turnName.textContent = myTurn ? me.name : (current ? current.name : '—');
    els.nextName.textContent = next ? next.name : '—';

    els.body.dataset.turn = myTurn ? 'me' : 'other';
    els.themeColor.setAttribute('content', myTurn ? '#16a34a' : '#111111');

    els.skipBtn.hidden = !isHost();
    els.resetBtn.hidden = !isHost();

    if (myTurn && !lastWasMyTurn) {
      onBecameMyTurn();
    }
    if (!myTurn && lastWasMyTurn) {
      releaseWakeLock();
    }
    lastWasMyTurn = !!myTurn;
  }

  function renderPlayers() {
    els.playerCount.textContent = state.players.length;
    els.playerList.innerHTML = '';
    state.players.forEach((p, idx) => {
      const li = document.createElement('li');
      const isCurrent = state.started && idx === state.currentIndex;
      if (isCurrent) li.classList.add('is-current');
      if (p.id === state.you) li.classList.add('is-you');
      if (p.id === state.hostId) li.classList.add('is-host');
      if (!p.connected) li.classList.add('disconnected');

      const name = document.createElement('span');
      name.className = 'pname';
      name.textContent = p.name;

      const meta = document.createElement('span');
      meta.className = 'meta';
      if (isCurrent) meta.textContent = 'on the clock';
      else if (!p.connected) meta.textContent = 'offline';
      else meta.textContent = `#${idx + 1}`;

      li.appendChild(name);
      li.appendChild(meta);
      els.playerList.appendChild(li);
    });
  }

  function onBecameMyTurn() {
    if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
    requestWakeLock();
  }

  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch {}
  }

  function releaseWakeLock() {
    if (wakeLock) {
      try { wakeLock.release(); } catch {}
      wakeLock = null;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && lastWasMyTurn) {
      requestWakeLock();
    }
  });

  function showError(message) {
    els.lobbyError.textContent = message || '';
    if (message) {
      setTimeout(() => {
        if (els.lobbyError.textContent === message) els.lobbyError.textContent = '';
      }, 4000);
    }
  }

  function getName() {
    const name = els.name.value.trim().slice(0, 24);
    if (name) localStorage.setItem('hot-potato:name', name);
    return name;
  }

  els.createBtn.addEventListener('click', () => {
    const name = getName();
    if (!name) return showError('Enter your name first.');
    saveSession({ code: '', playerId: '', name });
    connect(() => send({ type: 'create_room', name }));
  });

  els.joinBtn.addEventListener('click', () => {
    const name = getName();
    const code = els.code.value.trim().toUpperCase();
    if (!name) return showError('Enter your name first.');
    if (code.length !== 4) return showError('Room code is 4 characters.');
    saveSession({ code, playerId: '', name });
    connect(() => send({ type: 'join_room', code, name }));
  });

  els.startBtn.addEventListener('click', () => send({ type: 'start_game' }));
  els.passBtn.addEventListener('click', () => send({ type: 'pass' }));
  els.skipBtn.addEventListener('click', () => {
    if (confirm('Skip the current player?')) send({ type: 'skip' });
  });
  els.resetBtn.addEventListener('click', () => {
    if (confirm('End the game and return to lobby?')) send({ type: 'reset' });
  });
  els.leaveBtn.addEventListener('click', () => {
    saveSession(null);
    state = null;
    if (ws) try { ws.close(); } catch {}
    setScreen('lobby');
  });

  els.code.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  });

  if (session && session.code && session.playerId) {
    connect(() => send({
      type: 'join_room',
      code: session.code,
      playerId: session.playerId,
      name: session.name,
    }));
  } else {
    setScreen('lobby');
  }
})();
