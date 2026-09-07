#!/usr/bin/env node
/**
 * Local chat UI for testing the agent via A2A.
 *
 * Usage:
 *   node scripts/chat-ui.js [--agent-url http://localhost:4004] [--port 5001]
 *
 * Requires the agent to be running first (npm run dev).
 * Reads XSUAA credentials from default-env.json and performs an interactive
 * Authorization Code + PKCE login so the agent runs under a real user session.
 *
 * After deploying xs-security.json changes, update the XSUAA service instance:
 *   cf update-service <xsuaa-instance> -c xs-security.json
 */

'use strict';

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID, randomBytes, createHash } = require('node:crypto');

// ── Config ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const AGENT_URL = getArg('--agent-url', 'http://localhost:4004');
const UI_PORT = parseInt(getArg('--port', '5001'), 10);
const ENV_FILE = path.resolve(__dirname, '..', 'default-env.json');
const REDIRECT_URI = `http://localhost:${UI_PORT}/callback`;

// ── XSUAA credentials ──────────────────────────────────────────────────────────

function loadXsuaaCredentials() {
  if (!fs.existsSync(ENV_FILE)) {
    throw new Error(`default-env.json not found at ${ENV_FILE}`);
  }
  const env = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8'));
  const xsuaa = env?.VCAP_SERVICES?.xsuaa?.[0]?.credentials;
  if (!xsuaa?.clientid || !xsuaa?.clientsecret || !xsuaa?.url) {
    throw new Error('Missing xsuaa credentials (clientid, clientsecret, url) in default-env.json');
  }
  return xsuaa;
}

let xsuaa;

// ── PKCE helpers ───────────────────────────────────────────────────────────────

function generatePKCE() {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// ── Session store (in-memory, keyed by session cookie) ────────────────────────
// Each session: { accessToken, refreshToken, expiresAt, user }

const sessions = new Map();

function getSessionId(req) {
  const cookie = req.headers.cookie ?? '';
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  return match?.[1] ?? null;
}

function setSessionCookie(res, sessionId) {
  res.setHeader('Set-Cookie', `session=${sessionId}; HttpOnly; SameSite=Lax; Path=/`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

// Pending OAuth states: stateKey → { pkceVerifier, originalPath }
const pendingStates = new Map();

// ── Token operations ───────────────────────────────────────────────────────────

async function exchangeCodeWithVerifier(code, verifier) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: xsuaa.clientid,
    client_secret: xsuaa.clientsecret,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });

  const res = await fetch(`${xsuaa.url}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: xsuaa.clientid,
    client_secret: xsuaa.clientsecret,
    refresh_token: refreshToken,
  });

  const res = await fetch(`${xsuaa.url}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) return null;
  return res.json();
}

async function getValidToken(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;

  // Still valid with 60s buffer
  if (Date.now() < session.expiresAt - 60_000) {
    return session.accessToken;
  }

  // Try refresh
  if (session.refreshToken) {
    const data = await refreshAccessToken(session.refreshToken);
    if (data?.access_token) {
      session.accessToken = data.access_token;
      session.expiresAt = Date.now() + data.expires_in * 1000;
      if (data.refresh_token) session.refreshToken = data.refresh_token;
      return session.accessToken;
    }
  }

  sessions.delete(sessionId);
  return null;
}

// ── A2A proxy ──────────────────────────────────────────────────────────────────

async function proxyStream(userText, contextId, sessionId, res) {
  const token = await getValidToken(sessionId);
  if (!token) {
    res.write(`data: ${JSON.stringify({ error: 'Session expired — please reload and log in again.' })}\n\n`);
    res.end();
    return;
  }

  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id: randomUUID(),
    method: 'message/stream',
    params: {
      message: {
        kind: 'message',
        messageId: randomUUID(),
        role: 'user',
        parts: [{ kind: 'text', text: userText }],
        contextId,
      },
    },
  });

  const agentRes = await fetch(AGENT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Accept: 'text/event-stream',
    },
    body: payload,
  });

  if (!agentRes.ok) {
    const text = await agentRes.text();
    res.write(`data: ${JSON.stringify({ error: `Agent error (${agentRes.status}): ${text}` })}\n\n`);
    res.end();
    return;
  }

  const reader = agentRes.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
  } finally {
    res.end();
  }
}

// ── HTML UI ────────────────────────────────────────────────────────────────────

function buildHTML(user) {
  const displayName = user?.given_name
    ? `${user.given_name} ${user.family_name ?? ''}`.trim()
    : (user?.email ?? user?.user_name ?? 'User');

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Agent Chat</title>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f5f5f5;
      display: flex;
      flex-direction: column;
      height: 100dvh;
      color: #1a1a1a;
    }

    header {
      background: #003366;
      color: #fff;
      padding: 14px 20px;
      font-size: 16px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }

    header span.badge {
      font-size: 11px;
      background: rgba(255,255,255,0.2);
      border-radius: 4px;
      padding: 2px 7px;
      font-weight: 400;
    }

    header span.user-badge {
      font-size: 11px;
      background: rgba(255,255,255,0.15);
      border-radius: 4px;
      padding: 2px 7px;
      font-weight: 400;
      margin-left: 2px;
    }

    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .msg {
      max-width: 72%;
      padding: 10px 14px;
      border-radius: 12px;
      line-height: 1.5;
      font-size: 14px;
      word-break: break-word;
    }

    .msg.user { white-space: pre-wrap; }

    .msg.agent p { margin: 0 0 8px; }
    .msg.agent p:last-child { margin-bottom: 0; }
    .msg.agent ul, .msg.agent ol { margin: 0 0 8px 18px; }
    .msg.agent li { margin-bottom: 2px; }
    .msg.agent code { background: #f0f0f0; padding: 1px 4px; border-radius: 3px; font-size: 13px; }
    .msg.agent pre { background: #f0f0f0; padding: 10px; border-radius: 6px; overflow-x: auto; margin: 0 0 8px; }
    .msg.agent pre code { background: none; padding: 0; }
    .msg.agent h1, .msg.agent h2, .msg.agent h3 { margin: 8px 0 4px; font-size: 14px; }
    .msg.agent strong { font-weight: 600; }
    .msg.agent a { color: #003366; }

    .msg.user {
      background: #003366;
      color: #fff;
      align-self: flex-end;
      border-bottom-right-radius: 4px;
    }

    .msg.agent {
      background: #fff;
      border: 1px solid #e0e0e0;
      align-self: flex-start;
      border-bottom-left-radius: 4px;
    }

    .msg.agent.working {
      color: #666;
      font-style: italic;
      border-style: dashed;
    }

    .msg.error {
      background: #fff0f0;
      border: 1px solid #f5c0c0;
      color: #b00;
      align-self: flex-start;
      border-bottom-left-radius: 4px;
    }

    #form {
      display: flex;
      gap: 10px;
      padding: 16px 20px;
      background: #fff;
      border-top: 1px solid #e0e0e0;
      flex-shrink: 0;
    }

    #input {
      flex: 1;
      padding: 10px 14px;
      border: 1px solid #ccc;
      border-radius: 8px;
      font-size: 14px;
      outline: none;
      resize: none;
      height: 44px;
      min-height: 44px;
      max-height: 160px;
      overflow-y: auto;
      font-family: inherit;
      line-height: 1.5;
    }

    #input:focus { border-color: #003366; }

    #send {
      padding: 0 20px;
      background: #003366;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      cursor: pointer;
      height: 44px;
      white-space: nowrap;
    }

    #send:disabled { opacity: 0.5; cursor: not-allowed; }
    #send:not(:disabled):hover { background: #004488; }

    .dot-flashing {
      display: inline-block;
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #999;
      animation: dot-flashing 1s infinite alternate;
    }
    .dot-flashing::before, .dot-flashing::after {
      content: '';
      display: inline-block;
      position: relative;
      top: 0;
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #999;
      animation: dot-flashing 1s infinite alternate;
    }
    .dot-flashing::before { left: -14px; animation-delay: 0s; }
    .dot-flashing::after  { left:  14px; animation-delay: 0.5s; }
    @keyframes dot-flashing {
      0%   { background: #ccc; }
      100% { background: #666; }
    }

    #new-chat {
      background: none;
      border: 1px solid rgba(255,255,255,0.4);
      color: #fff;
      border-radius: 6px;
      padding: 4px 12px;
      font-size: 12px;
      cursor: pointer;
    }
    #new-chat:hover { background: rgba(255,255,255,0.15); }

    #logout {
      background: none;
      border: 1px solid rgba(255,255,255,0.4);
      color: #fff;
      border-radius: 6px;
      padding: 4px 12px;
      font-size: 12px;
      cursor: pointer;
      margin-left: auto;
    }
    #logout:hover { background: rgba(255,255,255,0.15); }
  </style>
</head>
<body>
  <header>
    Agent Chat
    <span class="badge">A2A · local</span>
    <span class="user-badge">&#128100; ${displayName}</span>
    <button id="new-chat" title="Start a new conversation">New chat</button>
    <button id="logout" title="Log out">Log out</button>
  </header>

  <div id="messages"></div>

  <form id="form">
    <textarea id="input" placeholder="Send a message…" rows="1"></textarea>
    <button id="send" type="submit">Send</button>
  </form>

  <script>
    const messagesEl = document.getElementById('messages');
    const form = document.getElementById('form');
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('send');

    let contextId = crypto.randomUUID();

    document.getElementById('new-chat').addEventListener('click', () => {
      contextId = crypto.randomUUID();
      messagesEl.innerHTML = '';
      input.focus();
    });

    document.getElementById('logout').addEventListener('click', () => {
      window.location.href = '/logout';
    });

    // Auto-grow textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 160) + 'px';
    });

    // Submit on Enter (Shift+Enter for newline)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    });

    function scrollToBottom() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function addMessage(role, text, cls = '') {
      const el = document.createElement('div');
      el.className = ['msg', role, cls].filter(Boolean).join(' ');
      el.textContent = text;
      messagesEl.appendChild(el);
      scrollToBottom();
      return el;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;

      input.value = '';
      input.style.height = '44px';
      sendBtn.disabled = true;

      addMessage('user', text);

      const agentEl = addMessage('agent', '···', 'working');

      try {
        const res = await fetch('/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, contextId }),
        });

        if (res.status === 401) {
          window.location.href = '/login';
          return;
        }

        if (!res.ok) {
          const err = await res.text();
          agentEl.className = 'msg error';
          agentEl.textContent = 'Error: ' + err;
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let latestText = '';
        let finished = false;

        while (!finished) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE lines
          const lines = buffer.split('\\n');
          buffer = lines.pop(); // keep incomplete line

          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const raw = line.slice(5).trim();
            if (!raw || raw === '[DONE]') continue;

            let evt;
            try { evt = JSON.parse(raw); } catch { continue; }

            if (evt.error) {
              agentEl.className = 'msg error';
              agentEl.textContent = evt.error;
              finished = true;
              break;
            }

            const state = evt?.result?.status?.state;

            // Extract text from A2A status-update events
            const text = evt?.result?.status?.message?.parts
              ?.filter(p => p.kind === 'text')
              ?.map(p => p.text)
              ?.join('') ?? '';

            if (text) {
              latestText = text;
              agentEl.className = state === 'failed' ? 'msg error' : 'msg agent';
              agentEl.innerHTML = state === 'failed' ? latestText : marked.parse(latestText);
              scrollToBottom();
            }

            // Final event — stop
            if (evt?.result?.final === true) {
              finished = true;
              break;
            }
          }
        }

        if (!latestText) {
          agentEl.className = 'msg agent';
          agentEl.textContent = '(no response)';
        }

      } catch (err) {
        agentEl.className = 'msg error';
        agentEl.textContent = 'Network error: ' + err.message;
      } finally {
        sendBtn.disabled = false;
        input.focus();
      }
    });

    input.focus();
  </script>
</body>
</html>`;
}

const LOGIN_HTML = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Agent Chat — Login</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f5f5f5;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100dvh;
      color: #1a1a1a;
    }
    .card {
      background: #fff;
      border: 1px solid #e0e0e0;
      border-radius: 12px;
      padding: 40px;
      text-align: center;
      max-width: 360px;
      width: 100%;
    }
    h1 { font-size: 20px; margin-bottom: 8px; color: #003366; }
    p { font-size: 14px; color: #666; margin-bottom: 28px; }
    a.btn {
      display: inline-block;
      background: #003366;
      color: #fff;
      text-decoration: none;
      padding: 12px 32px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
    }
    a.btn:hover { background: #004488; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Agent Chat</h1>
    <p>Sign in with your SAP BTP account to start chatting.</p>
    <a class="btn" href="/login">Sign in</a>
  </div>
</body>
</html>`;

// ── HTTP server ────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${UI_PORT}`);

  // ── GET / — serve chat UI (requires session) ─────────────────────────────
  if (req.method === 'GET' && url.pathname === '/') {
    const sessionId = getSessionId(req);
    const session = sessionId ? sessions.get(sessionId) : null;

    if (!session) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(LOGIN_HTML);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(buildHTML(session.user));
    return;
  }

  // ── GET /login — start PKCE Authorization Code flow ──────────────────────
  if (req.method === 'GET' && url.pathname === '/login') {
    const { verifier, challenge } = generatePKCE();
    const state = randomBytes(16).toString('hex');

    pendingStates.set(state, { verifier });
    // Clean up after 10 minutes
    setTimeout(() => pendingStates.delete(state), 10 * 60 * 1000);

    const authUrl = new URL(`${xsuaa.url}/oauth/authorize`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', xsuaa.clientid);
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    res.writeHead(302, { Location: authUrl.toString() });
    res.end();
    return;
  }

  // ── GET /callback — exchange code for tokens ─────────────────────────────
  if (req.method === 'GET' && url.pathname === '/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(`Login failed: ${error} — ${url.searchParams.get('error_description') ?? ''}`);
      return;
    }

    const pending = pendingStates.get(state);
    if (!code || !pending) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid or expired login state. Please try again.');
      return;
    }
    pendingStates.delete(state);

    let tokenData;
    try {
      tokenData = await exchangeCodeWithVerifier(code, pending.verifier);
    } catch (err) {
      console.error('[chat-ui] Token exchange error:', err.message);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Authentication error: ${err.message}`);
      return;
    }

    // Decode user info from the JWT payload (no signature verification needed locally)
    let user = {};
    try {
      const payload = tokenData.access_token.split('.')[1];
      user = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      // non-critical
    }

    const sessionId = randomUUID();
    sessions.set(sessionId, {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token ?? null,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
      user,
    });

    setSessionCookie(res, sessionId);
    res.writeHead(302, { Location: '/' });
    res.end();
    return;
  }

  // ── GET /logout ───────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/logout') {
    const sessionId = getSessionId(req);
    if (sessionId) sessions.delete(sessionId);
    clearSessionCookie(res);
    res.writeHead(302, { Location: '/' });
    res.end();
    return;
  }

  // ── POST /stream — proxy to agent (requires session) ─────────────────────
  if (req.method === 'POST' && url.pathname === '/stream') {
    const sessionId = getSessionId(req);
    if (!sessionId || !sessions.has(sessionId)) {
      res.writeHead(401);
      res.end('Unauthorized');
      return;
    }

    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      let text, contextId;
      try {
        ({ text, contextId } = JSON.parse(body));
      } catch {
        res.writeHead(400);
        res.end('Bad request');
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      try {
        await proxyStream(text, contextId, sessionId, res);
      } catch (err) {
        console.error('[chat-ui] Proxy error:', err.message);
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// ── Start ──────────────────────────────────────────────────────────────────────

async function start() {
  try {
    xsuaa = loadXsuaaCredentials();
  } catch (err) {
    console.error(`[chat-ui] ${err.message}`);
    process.exit(1);
  }

  server.listen(UI_PORT, () => {
    const uiUrl = `http://localhost:${UI_PORT}`;
    console.log(`[chat-ui] Chat UI running at ${uiUrl}`);
    console.log(`[chat-ui] Proxying A2A requests to ${AGENT_URL}`);
    console.log('[chat-ui] Make sure the agent is running (npm run dev)');
    console.log(`[chat-ui] Callback URI registered: ${REDIRECT_URI}`);
    console.log('[chat-ui] NOTE: ensure xs-security.json redirect-uris are deployed to XSUAA');

    const open =
      process.platform === 'darwin' ? 'open' :
      process.platform === 'win32'  ? 'start' :
      'xdg-open';
    require('node:child_process').exec(`${open} ${uiUrl}`);
  });
}

start().catch((err) => {
  console.error('[chat-ui] Fatal:', err.message);
  process.exit(1);
});
