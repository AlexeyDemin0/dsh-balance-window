/**
 * dsh-balance-window — Host half.
 *
 * Answers one read-only JSON route with two things the minimal floating window
 * needs:
 *
 *  1. The DeepSeek wallet balance, read from the official
 *     `GET https://api.deepseek.com/user/balance` endpoint with the API key
 *     stored in DSH credentials (the same figure platform.deepseek.com shows),
 *     or — when no API key is configured — through the Host `deepseekAccount`
 *     service, which is how an account-login Desktop install reaches it.
 *  2. The estimated money spent by each completed turn, folded from durable
 *     `session/event` usage records and priced with the published DeepSeek
 *     rates (off-peak/peak, cache hit/miss/output).
 *
 * The API key never leaves the Host: the browser only ever sees the balance and
 * the turn costs.
 *
 * @module dsh-balance-window
 */

/** Package identity, reported to the account service as this client's version. */
const PKG_NAME = '@alexey_demin/dsh-balance-window'

/** Official wallet endpoint; returns `balance_infos[]` for the key's account. */
const BALANCE_URL = 'https://api.deepseek.com/user/balance'

/** Off-peak USD price per 1,000,000 tokens (https://api-docs.deepseek.com/quick_start/pricing). */
const DEFAULT_PRICES = {
  flash: { hit: 0.003, miss: 0.15, out: 0.6 },
  pro: { hit: 0.022, miss: 0.66, out: 1.98 },
}

/**
 * Peak windows in UTC hours, weekday-only, per the same pricing page
 * (01:00–04:00 and 06:00–10:00 UTC, Monday through Friday; Chinese public
 * holidays are not modelled, so those hours price as peak).
 */
const DEFAULT_PEAK = {
  multiplier: 2,
  utcWindows: [
    [1, 4],
    [6, 10],
  ],
  weekdaysOnly: true,
}

const DEFAULTS = {
  path: '/balance-window/state',
  apiKeyRef: 'DEEPSEEK_API_KEY',
  refreshMs: 60000,
  timeoutMs: 8000,
  prices: DEFAULT_PRICES,
  peak: DEFAULT_PEAK,
  usdToCny: 7.2,
  keepTurns: 20,
  recentTurns: 50,
}

/** Host plugin entry point. The route needs the HTTP carrier; the optional
 * `credentials` and `deepseekAccount` services are resolved through `ctx.get`
 * so a Host without them still serves the route (and reports why). */
export const inject = ['webServer']

export function apply(ctx, config = {}) {
  const cfg = normalizeConfig(config)

  /** Last balance read: `{ at, ok, source, available, wallets, error }`. */
  let balanceCache = null
  /** Single-flight guard so parallel polls share one upstream request. */
  let balanceInFlight = null

  /** sessionId -> in-flight turn aggregate. */
  const turnAggs = new Map()
  /** sessionId -> completed turn records, newest last (capped at cfg.keepTurns). */
  const turnsBySession = new Map()
  /** Newest completed turn records across every session (capped at cfg.recentTurns). */
  const recentTurns = []
  /** Local-day estimate accumulator. */
  let today = { day: dayKey(Date.now()), cost: 0, tokens: 0, turns: 0 }

  const disposers = []

  // ---------------------------------------------------------------- balance --

  function credentialService() {
    try {
      return ctx.get('credentials', false) || null
    } catch (err) {
      /* a host without the credentials service simply has no API-key route */
    }
    return null
  }

  async function fetchApiKeyBalance(key) {
    const res = await fetch(BALANCE_URL, {
      headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
      signal: AbortSignal.timeout(cfg.timeoutMs),
    })
    if (!res.ok) {
      return { ok: false, code: 'HTTP_' + res.status, message: 'balance API returned HTTP ' + res.status }
    }
    let data
    try {
      data = await res.json()
    } catch (err) {
      return { ok: false, code: 'PARSE', message: 'balance API returned invalid JSON' }
    }
    const infos = Array.isArray(data && data.balance_infos) ? data.balance_infos : []
    const wallets = infos.map(toWallet).filter((w) => w.total !== null)
    if (!wallets.length) {
      return { ok: false, code: 'SHAPE', message: 'balance API returned no usable wallet' }
    }
    return {
      ok: true,
      source: 'apikey',
      available: data.is_available !== false,
      wallets,
    }
  }

  /**
   * Account-login fallback. The `deepseekAccount` service owns platform token
   * injection; we only ask it for the display-safe balance projection.
   */
  async function fetchAccountBalance() {
    let account = null
    try {
      account = ctx.get('deepseekAccount', false) || null
    } catch (err) {
      account = null
    }
    if (!account || typeof account.getBalance !== 'function') {
      return { ok: false, code: 'NO_ACCOUNT', message: 'no DeepSeek account is signed in on this Host' }
    }
    const client = {
      version: PKG_NAME,
      locale: 'en',
      timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
    }
    const outcome = await account.getBalance(client)
    if (!outcome || outcome.status !== 'ready') {
      return { ok: false, code: 'ACCOUNT_FAILED', message: 'the account balance query failed' }
    }
    const wallets = (outcome.value || []).map(toWallet).filter((w) => w.total !== null)
    const bonusWallets = (outcome.bonusWallets || []).map((w) => ({ ...toWallet(w), bonus: true }))
    if (!wallets.length && !bonusWallets.length) {
      return { ok: false, code: 'ACCOUNT_EMPTY', message: 'the account reported no wallet' }
    }
    return { ok: true, source: 'account', available: true, wallets: wallets.concat(bonusWallets) }
  }

  async function fetchBalance() {
    let keyFailure = null
    const credentials = credentialService()
    if (credentials && typeof credentials.resolve === 'function') {
      try {
        const credential = await credentials.resolve(cfg.apiKeyRef)
        if (credential && credential.value) {
          const read = await fetchApiKeyBalance(credential.value)
          if (read.ok) return read
          keyFailure = read
        } else {
          keyFailure = { ok: false, code: 'NO_KEY', message: 'credential ' + cfg.apiKeyRef + ' is not set' }
        }
      } catch (err) {
        keyFailure = { ok: false, code: 'CREDENTIALS', message: short(err) }
      }
    } else {
      keyFailure = { ok: false, code: 'NO_KEY', message: 'credential ' + cfg.apiKeyRef + ' is not set' }
    }
    try {
      const account = await fetchAccountBalance()
      if (account.ok) return account
      if (keyFailure && keyFailure.code === 'NO_KEY') return keyFailure
      return { ok: false, code: keyFailure ? keyFailure.code : 'FAIL', message: (keyFailure ? keyFailure.message + '; ' : '') + account.message }
    } catch (err) {
      return { ok: false, code: 'FAIL', message: (keyFailure ? keyFailure.message + '; ' : '') + short(err) }
    }
  }

  async function readBalance(force) {
    const now = Date.now()
    if (!force && balanceCache && now - balanceCache.at < cfg.refreshMs) return balanceCache
    if (!balanceInFlight) {
      balanceInFlight = (async () => {
        try {
          return await fetchBalance()
        } catch (err) {
          return { ok: false, code: 'FAIL', message: short(err) }
        } finally {
          balanceInFlight = null
        }
      })()
    }
    const outcome = await balanceInFlight
    balanceCache = { at: Date.now(), ...outcome }
    return balanceCache
  }

  /** The wallet the window shows: the first funded one, else the first. */
  function primaryWallet(balance) {
    if (!balance || !balance.ok || !Array.isArray(balance.wallets) || !balance.wallets.length) return null
    const funded = balance.wallets.find((w) => typeof w.total === 'number' && w.total > 0)
    return funded || balance.wallets[0]
  }

  // ------------------------------------------------------------- turn costs --

  function priceTableFor(currency) {
    const base = cfg.prices
    if (currency === 'CNY') {
      const rate = cfg.usdToCny
      const scaled = {}
      for (const family of Object.keys(base)) {
        scaled[family] = {
          hit: base[family].hit * rate,
          miss: base[family].miss * rate,
          out: base[family].out * rate,
        }
      }
      return scaled
    }
    return base
  }

  /** `deepseek-v4-pro` prices as pro; every other route as flash. */
  function familyOf(model) {
    return /pro|reasoner/i.test(String(model || '')) ? 'pro' : 'flash'
  }

  function isPeak(ms) {
    if (!cfg.peak) return false
    const date = new Date(ms)
    const day = date.getUTCDay()
    if (cfg.peak.weekdaysOnly && (day === 0 || day === 6)) return false
    const hour = date.getUTCHours() + date.getUTCMinutes() / 60
    return cfg.peak.utcWindows.some(([from, to]) => hour >= from && hour < to)
  }

  function priceStep(usage, model, currency, at) {
    const family = familyOf(model)
    const table = priceTableFor(currency)[family] || priceTableFor(currency).flash
    const peak = isPeak(at)
    const multiplier = peak ? cfg.peak.multiplier : 1
    const cacheRead = number(usage.cacheReadTokens)
    const uncached = number(usage.inputTokens) + number(usage.cacheWriteTokens)
    const output = number(usage.outputTokens)
    const cost = ((cacheRead * table.hit + uncached * table.miss + output * table.out) / 1e6) * multiplier
    return { cost, tokens: cacheRead + uncached + output, family, peak, model: String(model || '') }
  }

  function noteUsage(sessionId, data) {
    const usage = data.usage
    if (!usage || typeof usage !== 'object') return
    const turn = Number(data.turn)
    if (!Number.isFinite(turn)) return
    let agg = turnAggs.get(sessionId)
    if (!agg || agg.turn !== turn) {
      if (agg) finalizeTurn(sessionId, agg)
      agg = {
        turn,
        startedAt: Date.now(),
        model: (data.message && data.message.source && data.message.source.model) || '',
        cost: 0,
        tokens: 0,
        steps: 0,
        peak: false,
      }
      turnAggs.set(sessionId, agg)
    }
    const currency = (primaryWallet(balanceCache) || {}).currency || 'USD'
    const step = priceStep(usage, (data.message && data.message.source && data.message.source.model) || agg.model, currency, Date.now())
    agg.cost += step.cost
    agg.tokens += step.tokens
    agg.steps += 1
    agg.peak = agg.peak || step.peak
    if (step.model) agg.model = step.model
    // The currency a turn was priced in travels with it, so a later wallet
    // switch cannot restate history.
    agg.currency = currency
  }

  function finalizeTurn(sessionId, agg) {
    const pending = agg || turnAggs.get(sessionId)
    if (!pending) return
    turnAggs.delete(sessionId)
    if (!(pending.tokens > 0) && !(pending.cost > 0)) return
    const record = {
      turn: pending.turn,
      at: pending.completedAt || Date.now(),
      cost: round(pending.cost, 6),
      tokens: pending.tokens,
      steps: pending.steps,
      model: pending.model,
      family: familyOf(pending.model),
      peak: Boolean(pending.peak),
      currency: pending.currency || 'USD',
    }
    const list = turnsBySession.get(sessionId) || []
    list.push(record)
    while (list.length > cfg.keepTurns) list.shift()
    turnsBySession.set(sessionId, list)

    recentTurns.push({ ...record, session: sessionId })
    while (recentTurns.length > cfg.recentTurns) recentTurns.shift()

    const day = dayKey(record.at)
    if (day !== today.day) today = { day, cost: 0, tokens: 0, turns: 0 }
    today.cost += record.cost
    today.tokens += record.tokens
    today.turns += 1
  }

  // ------------------------------------------------------------------ state --

  async function stateFor(sessionId, force) {
    const balance = await readBalance(force)
    const wallet = primaryWallet(balance)
    const currency = (wallet && wallet.currency) || 'USD'
    const live = turnAggs.get(sessionId)
    const turns = sessionId
      ? (turnsBySession.get(sessionId) || []).slice(-cfg.keepTurns).reverse()
      : recentTurns.slice(-12).reverse()
    const day = dayKey(Date.now())
    if (day !== today.day) today = { day, cost: 0, tokens: 0, turns: 0 }
    return {
      ok: true,
      now: Date.now(),
      balance: balance.ok
        ? { available: balance.available !== false, wallets: balance.wallets, currency }
        : null,
      balanceError: balance.ok ? null : { code: balance.code || 'FAIL', message: balance.message || 'balance unavailable' },
      source: balance.source || null,
      updatedAt: balance.at || null,
      today: { day: today.day, cost: round(today.cost, 6), tokens: today.tokens, turns: today.turns },
      liveTurn: live
        ? { turn: live.turn, cost: round(live.cost, 6), tokens: live.tokens, steps: live.steps, model: live.model }
        : null,
      turns,
      pricing: {
        base: 'USD',
        currency,
        usdToCny: cfg.usdToCny,
        multiplier: cfg.peak ? cfg.peak.multiplier : 1,
        families: priceTableFor(currency),
        source: 'https://api-docs.deepseek.com/quick_start/pricing',
      },
      host: { path: cfg.path, refreshMs: cfg.refreshMs, keepTurns: cfg.keepTurns },
    }
  }

  // ------------------------------------------------------------------ routes --

  async function handleState(req, res) {
    const site = req.headers['sec-fetch-site']
    if (typeof site === 'string' && site.toLowerCase() === 'cross-site') {
      return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'cross-site request refused' } })
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { ok: false, error: { code: 'METHOD', message: 'GET only' } })
    }
    let url
    try {
      url = new URL(req.url || '/', 'http://localhost')
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: { code: 'URL', message: 'malformed request' } })
    }
    try {
      const state = await stateFor(url.searchParams.get('session') || '', url.searchParams.get('refresh') === '1')
      return sendJson(res, 200, state)
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: { code: 'FAIL', message: short(err) } })
    }
  }

  function registerRoute(route) {
    const register = ctx.webServer && typeof ctx.webServer.register === 'function' ? ctx.webServer.register.bind(ctx.webServer) : null
    if (!register) return
    try {
      disposers.push(register(route))
    } catch (err) {
      try {
        console.warn('[balance-window] route registration failed: ' + short(err))
      } catch (inner) {
        /* nothing left to report to */
      }
    }
  }

  // ------------------------------------------------------------------- wiring --

  registerRoute({ kind: 'exact', path: cfg.path, handler: handleState })

  try {
    disposers.push(
      ctx.on('session/event', (session, event) => {
        try {
          const type = event && event.type
          if (type === 'turn/end') {
            const agg = turnAggs.get(sessionKey(session))
            if (agg) agg.completedAt = Date.now()
            finalizeTurn(sessionKey(session), agg)
            return
          }
          if (type !== 'assistant/message' || !event.data) return
          noteUsage(sessionKey(session), event.data)
        } catch (err) {
          /* a fold bug must never break the agent loop */
        }
      }),
    )
  } catch (err) {
    /* a host without the event bus still serves the balance route */
  }

  try {
    disposers.push(
      ctx.on('session/disposed', (session) => {
        const key = sessionKey(session)
        turnAggs.delete(key)
        turnsBySession.delete(key)
      }),
    )
  } catch (err) {
    /* optional */
  }

  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0).reverse()) {
      try {
        if (typeof dispose === 'function') dispose()
      } catch (err) {
        /* best-effort teardown */
      }
    }
  })
}

// -------------------------------------------------------------------- helpers --

function normalizeConfig(config) {
  const input = config && typeof config === 'object' ? config : {}
  const cfg = { ...DEFAULTS, ...input }
  cfg.path = typeof cfg.path === 'string' && cfg.path.startsWith('/') ? cfg.path : DEFAULTS.path
  cfg.apiKeyRef = typeof cfg.apiKeyRef === 'string' && cfg.apiKeyRef ? cfg.apiKeyRef : DEFAULTS.apiKeyRef
  cfg.refreshMs = clamp(cfg.refreshMs, 5000, 3600000, DEFAULTS.refreshMs)
  cfg.timeoutMs = clamp(cfg.timeoutMs, 1000, 60000, DEFAULTS.timeoutMs)
  cfg.usdToCny = positive(cfg.usdToCny, DEFAULTS.usdToCny)
  cfg.keepTurns = clamp(cfg.keepTurns, 1, 200, DEFAULTS.keepTurns)
  cfg.recentTurns = clamp(cfg.recentTurns, 1, 500, DEFAULTS.recentTurns)

  const prices = {}
  const source = cfg.prices && typeof cfg.prices === 'object' ? cfg.prices : {}
  for (const family of Object.keys(DEFAULT_PRICES)) {
    const row = source[family] && typeof source[family] === 'object' ? source[family] : {}
    prices[family] = {
      hit: nonNegative(row.hit, DEFAULT_PRICES[family].hit),
      miss: nonNegative(row.miss, DEFAULT_PRICES[family].miss),
      out: nonNegative(row.out, DEFAULT_PRICES[family].out),
    }
  }
  cfg.prices = prices

  const peak = cfg.peak && typeof cfg.peak === 'object' ? cfg.peak : {}
  const windows = Array.isArray(peak.utcWindows)
    ? peak.utcWindows
        .map((pair) => (Array.isArray(pair) ? [Number(pair[0]), Number(pair[1])] : null))
        .filter((pair) => pair && Number.isFinite(pair[0]) && Number.isFinite(pair[1]) && pair[0] < pair[1])
    : []
  cfg.peak =
    peak === false || windows.length === 0
      ? null
      : {
          multiplier: positive(peak.multiplier, DEFAULT_PEAK.multiplier),
          utcWindows: windows,
          weekdaysOnly: peak.weekdaysOnly !== false,
        }
  return cfg
}

function toWallet(raw) {
  const total = number(raw && raw.total_balance)
  const granted = number(raw && raw.granted_balance)
  const toppedUp = number(raw && raw.topped_up_balance)
  return {
    currency: String((raw && raw.currency) || 'USD').toUpperCase(),
    total,
    granted: granted === 0 && raw && raw.granted_balance === undefined ? null : granted,
    toppedUp: toppedUp === 0 && raw && raw.topped_up_balance === undefined ? null : toppedUp,
    bonus: Boolean(raw && raw.bonus),
  }
}

function sessionKey(session) {
  return session && session.id ? String(session.id) : 'default'
}

function dayKey(ms) {
  const date = new Date(ms)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return date.getFullYear() + '-' + month + '-' + day
}

function sendJson(res, status, body) {
  let payload
  try {
    payload = JSON.stringify(body)
  } catch (err) {
    payload = '{"ok":false,"error":{"code":"SERIALIZE"}}'
    status = 500
  }
  try {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(payload),
    })
    res.end(payload)
  } catch (err) {
    /* the client went away */
  }
}

function short(err) {
  const message = err && err.message ? err.message : String(err)
  return message.slice(0, 200)
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function round(value, digits) {
  const factor = Math.pow(10, digits)
  return Math.round(value * factor) / factor
}

function clamp(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

function positive(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function nonNegative(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}
