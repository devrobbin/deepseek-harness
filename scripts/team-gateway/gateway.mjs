/**
 * Team gateway — zero-dependency reverse proxy with login (方案 A).
 *
 * One Node process fronts one DSH web instance per operator. Each operator
 * authenticates once at the gateway; their session cookie routes every
 * request (and WebSocket upgrade) to that operator's own DSH instance, which
 * runs with its own DSH_HOME — so memory, scheduler jobs, and session logs
 * are per-user by construction, with no DSH kernel changes.
 *
 * Usage:
 *   node scripts/team-gateway/gateway.mjs [configPath]
 * Config (default scripts/team-gateway/team.json):
 *   {
 *     "gatewayPort": 3090,
 *     "secret": "<long random string>",
 *     "users": [
 *       { "name": "yunying-a", "passwordHash": "<sha256(salt+password) hex>", "port": 3091 }
 *     ]
 *   }
 * Password hash: node -e "console.log(require('crypto').createHash('sha256').update('SALT' + 'PASSWORD').digest('hex'))"
 *
 * This is a LAN-grade gate for a trusted team network, not an internet-edge
 * firewall: passwords are single-hash, the cookie is HMAC-signed with the
 * configured secret, and upstream instances listen on localhost only.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import http from 'node:http'
import net from 'node:net'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const configPath = process.argv[2] ?? join(here, 'team.json')
const config = JSON.parse(readFileSync(configPath, 'utf8'))

const GATEWAY_PORT = config.gatewayPort ?? 3090
const SECRET = config.secret
if (!SECRET || SECRET.length < 16) {
  throw new Error('team.json: "secret" must be a long random string (node -e "console.log(randomBytes(32).toString(\'hex\'))")')
}
const usersByName = new Map(config.users.map((u) => [u.name, u]))
const COOKIE_NAME = 'tg_session'
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000

const sha256 = (text) => createHash('sha256').update(text).digest('hex')
const sign = (payload) => createHmac('sha256', SECRET).update(payload).digest('hex')

function safeEqual(a, b) {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

function parseCookies(header) {
  const out = {}
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  return out
}

/** Validate the session cookie; return the user record or null. */
function sessionUser(req) {
  const raw = parseCookies(req.headers.cookie)[COOKIE_NAME]
  if (!raw) return null
  const firstDot = raw.indexOf('.')
  const secondDot = raw.indexOf('.', firstDot + 1)
  if (firstDot < 0 || secondDot < 0) return null
  const user = raw.slice(0, firstDot)
  const exp = raw.slice(firstDot + 1, secondDot)
  const mac = raw.slice(secondDot + 1)
  if (!safeEqual(mac, sign(`${user}.${exp}`))) return null
  if (Number(exp) < Date.now()) return null
  return usersByName.get(user) ?? null
}

function issueCookie(user) {
  const exp = Date.now() + SESSION_TTL_MS
  return `${COOKIE_NAME}=${user}.${exp}.${sign(`${user}.${exp}`)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`
}

const LOGIN_PAGE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>运营平台登录</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#111;color:#eee}
.card{background:#1c1c1c;border:1px solid #333;border-radius:16px;padding:32px 40px;width:300px}
h1{font-size:18px;margin:0 0 20px}input{width:100%;box-sizing:border-box;padding:9px 12px;margin-bottom:12px;
border:1px solid #444;border-radius:8px;background:#222;color:#eee;font-size:14px}
button{width:100%;padding:10px;border:none;border-radius:8px;background:#4d6bfe;color:#fff;font-size:14px;cursor:pointer}
.err{color:#f66;font-size:13px;min-height:18px;margin:0 0 8px}</style></head><body>
<div class="card"><h1>亚马逊运营 Agent 平台</h1>
<form method="post" action="/__tg/login">
<p class="err"></p>
<input name="name" placeholder="运营账号" autofocus required>
<input name="password" type="password" placeholder="密码" required>
<button type="submit">登录</button></form></div></body></html>`

function loginPage(errorText) {
  const banner = errorText ? `<p class="err">${errorText}</p>` : '<p class="err"></p>'
  return LOGIN_PAGE.replace('<p class="err"></p>', banner)
}

function sendLoginError(res, message) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(loginPage(message))
}

function upstreamHeaders(req, user) {
  const headers = { ...req.headers, host: `127.0.0.1:${user.port}` }
  // Rewrite the browser's cross-origin markers to the upstream origin:
  // DSH's webserver rejects state-changing RPCs whose Origin/Referer do not
  // match the instance it serves, and behind the gateway they name :3090.
  if (typeof headers.origin === 'string') headers.origin = `http://127.0.0.1:${user.port}`
  if (typeof headers.referer === 'string') {
    headers.referer = headers.referer.replace(/\/\/[^/]+\//, `//127.0.0.1:${user.port}/`)
  }
  return headers
}

/** Identity banner injected into every HTML page: who am I + logout. */
function bannerHtml(user) {
  return `<div style="position:fixed;top:8px;right:12px;z-index:2147483647;display:flex;gap:8px;align-items:center;
font:12px/1.4 system-ui,sans-serif;background:rgba(20,20,24,.85);border:1px solid rgba(255,255,255,.18);
border-radius:999px;padding:4px 6px 4px 12px;color:#ddd;backdrop-filter:blur(6px)">
<span>👤 ${user}</span>
<a href="/__tg/logout" style="color:#fff;background:rgba(77,107,254,.75);border-radius:999px;padding:3px 10px;text-decoration:none">退出</a>
</div>`
}

function proxyHttp(req, res, user) {
  const upstream = { host: '127.0.0.1', port: user.port, path: req.url, method: req.method, headers: upstreamHeaders(req, user) }
  const ureq = http.request(upstream, (ures) => {
    const isHtml = (ures.headers['content-type'] ?? '').includes('text/html')
    if (!isHtml) {
      res.writeHead(ures.statusCode ?? 502, ures.headers)
      ures.pipe(res)
      return
    }
    // Buffer the HTML and append the identity banner before </body>.
    const chunks = []
    ures.on('data', (c) => chunks.push(c))
    ures.on('end', () => {
      let html = Buffer.concat(chunks).toString('utf8')
      const injected = html.includes('</body>')
        ? html.replace('</body>', bannerHtml(user.name) + '</body>')
        : html + bannerHtml(user.name)
      const headers = { ...ures.headers }
      // The buffered body gets an explicit length; the streamed framing must go.
      delete headers['content-length']
      delete headers['content-encoding']
      delete headers['transfer-encoding']
      headers['content-length'] = Buffer.byteLength(injected)
      res.writeHead(ures.statusCode ?? 200, headers)
      res.end(injected)
    })
  })
  ureq.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(`上游实例 ${user.name} (127.0.0.1:${user.port}) 未启动，请通知管理员运行 start-operator`)
  })
  req.pipe(ureq)
}

function proxyUpgrade(req, socket, head, user) {
  const upstream = net.connect(user.port, '127.0.0.1', () => {
    const headers = upstreamHeaders(req, user)
    const lines = [`GET ${req.url} HTTP/1.1`]
    for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`)
    upstream.write(lines.join('\r\n') + '\r\n\r\n')
    if (head.length > 0) upstream.write(head)
  })
  upstream.on('data', (chunk) => {
    // First chunk may carry the upstream upgrade response headers.
    if (!socket.writableEnded) socket.write(chunk)
  })
  upstream.pipe(socket)
  socket.pipe(upstream)
  socket.on('error', () => upstream.destroy())
  upstream.on('error', () => socket.destroy())
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/__tg/login' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(loginPage(null))
    return
  }
  if (url.pathname === '/__tg/login' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const form = new URLSearchParams(body)
      const name = form.get('name') ?? ''
      const password = form.get('password') ?? ''
      const user = usersByName.get(name)
      const ok = user !== undefined && safeEqual(sha256((config.salt ?? '') + password), user.passwordHash)
      if (!ok) {
        sendLoginError(res, '账号或密码错误')
        return
      }
      res.writeHead(302, { 'Set-Cookie': issueCookie(user.name), Location: '/' })
      res.end()
    })
    return
  }
  if (url.pathname === '/__tg/logout') {
    res.writeHead(302, { 'Set-Cookie': `${COOKIE_NAME}=; Max-Age=0; Path=/`, Location: '/__tg/login' })
    res.end()
    return
  }
  const user = sessionUser(req)
  if (user === null) {
    res.writeHead(302, { Location: '/__tg/login' })
    res.end()
    return
  }
  proxyHttp(req, res, user)
})

server.on('upgrade', (req, socket, head) => {
  const user = sessionUser(req)
  if (user === null) {
    socket.destroy()
    return
  }
  proxyUpgrade(req, socket, head, user)
})

server.listen(GATEWAY_PORT, () => {
  console.log(`team gateway: http://127.0.0.1:${GATEWAY_PORT} (${config.users.length} 个运营账号)`)
})
