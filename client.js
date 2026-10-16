/**
 * dsh-balance-window — Client half.
 *
 * One fixed chip in the sidebar foot, beside Settings (`sidebar.footer.action`):
 * the wallet balance and what the last turn cost. Hovering (or focusing) it opens
 * a fixed-position info panel with the full reading — recharge and granted
 * split, today's total, the last turn's tokens/steps/route, and the read time.
 *
 * The chip is a slot occupant of the sidebar column, so it cannot be dragged,
 * collapsed or dismissed — it is part of the column, and it stays there in the
 * wide sidebar and in the 56px rail. The panel only appears on hover and leaves
 * the chip exactly where it is.
 *
 * All numbers come from the Host route the sibling `host.js` registers; the API
 * key itself never reaches the browser.
 */
window.__ModuleLoader__.load({
  id: 'dsh-balance-window',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'balance-window'
    const ROUTE = '/balance-window/state'
    const POLL_MS = 10000
    const PANEL_WIDTH = 248
    const PANEL_GAP = 8
    const CLOSE_DELAY_MS = 180
    const PANEL_ID = 'balance-window-tip'

    const DICTS = {
      en: {
        title: 'Balance',
        aria: 'DeepSeek balance and the cost of the last turn',
        refresh: 'Refresh balance',
        loading: '…',
        unavailable: '—',
        level: 'Balance {balance}',
        last: 'Last turn #{turn}',
        live: 'Turn #{turn} running',
        tokens: 'tokens',
        steps: '{count} steps',
        peak: 'peak',
        today: 'Today',
        turnsCount: '{count} turns',
        granted: 'granted',
        toppedUp: 'topped up',
        updated: 'Updated {time}',
        estimated: 'estimate at published rates',
        click: 'click to refresh',
        needKey: 'Set {ref} in Settings → Models to read the balance.',
        errorGeneric: 'Balance unavailable: {message}',
        noTurns: 'no completed turn yet',
      },
      ru: {
        title: 'Баланс',
        aria: 'Баланс DeepSeek и стоимость последнего хода',
        refresh: 'Обновить баланс',
        loading: '…',
        unavailable: '—',
        level: 'Баланс {balance}',
        last: 'Последний ход #{turn}',
        live: 'Идёт ход #{turn}',
        tokens: 'токенов',
        steps: 'шагов: {count}',
        peak: 'пик',
        today: 'Сегодня',
        turnsCount: 'ходов: {count}',
        granted: 'подарок',
        toppedUp: 'пополнение',
        updated: 'Обновлено {time}',
        estimated: 'оценка по опубликованным тарифам',
        click: 'щелчок — обновить',
        needKey: 'Укажите {ref} в Настройки → Модели, чтобы видеть баланс.',
        errorGeneric: 'Баланс недоступен: {message}',
        noTurns: 'завершённых ходов пока нет',
      },
      zh: {
        title: '余额',
        aria: 'DeepSeek 余额与上一轮花费',
        refresh: '刷新余额',
        loading: '…',
        unavailable: '—',
        level: '余额 {balance}',
        last: '上一轮 #{turn}',
        live: '第 #{turn} 轮进行中',
        tokens: 'tokens',
        steps: '{count} 步',
        peak: '高峰',
        today: '今日',
        turnsCount: '{count} 轮',
        granted: '赠金',
        toppedUp: '充值',
        updated: '更新于 {time}',
        estimated: '按官方价格估算',
        click: '点击刷新',
        needKey: '请在 设置 → 模型 中配置 {ref} 以读取余额。',
        errorGeneric: '余额不可用：{message}',
        noTurns: '暂无已完成的轮次',
      },
    }

    // ------------------------------------------------------------- formatting --

    const SYMBOLS = { USD: '$', CNY: '¥' }

    function symbol(currency) {
      const code = String(currency || 'USD').toUpperCase()
      return SYMBOLS[code] || code + ' '
    }

    function formatMoney(value, currency) {
      const amount = Number(value)
      if (!Number.isFinite(amount)) return '—'
      const abs = Math.abs(amount)
      if (abs > 0 && abs < 0.01) return '<' + symbol(currency) + '0.01'
      return symbol(currency) + amount.toFixed(2)
    }

    function formatCost(value, currency) {
      const amount = Number(value)
      if (!Number.isFinite(amount)) return '—'
      if (amount === 0) return symbol(currency) + '0'
      if (Math.abs(amount) < 1) return symbol(currency) + amount.toFixed(4)
      return symbol(currency) + amount.toFixed(2)
    }

    function formatTokens(value) {
      const count = Number(value)
      if (!Number.isFinite(count) || count <= 0) return '0'
      if (count < 1000) return String(Math.round(count))
      if (count < 1000000) return (count / 1000).toFixed(count < 10000 ? 1 : 0) + 'k'
      return (count / 1000000).toFixed(2) + 'M'
    }

    function formatClock(ms) {
      if (!Number.isFinite(ms)) return '—'
      const date = new Date(ms)
      const pad = (value) => String(value).padStart(2, '0')
      return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
    }

    function formatTemplate(text, params) {
      return String(text == null ? '' : text).replace(/\{(\w+)\}/g, (match, key) =>
        params && Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match,
      )
    }

    function translate(t, key, params) {
      let text
      try {
        text = t(key, params)
      } catch (err) {
        text = undefined
      }
      if (text === undefined || text === null || text === key) {
        const fallback = DICTS.en[key]
        text = fallback === undefined ? key : fallback
      }
      return formatTemplate(text, params)
    }

    // -------------------------------------------------------------- transport --

    function route() {
      if (typeof document === 'undefined') return ROUTE
      try {
        return new URL(String(ROUTE).replace(/^\/+/, ''), document.baseURI).pathname
      } catch (err) {
        return ROUTE
      }
    }

    async function readState(force) {
      const response = await fetch(route() + (force ? '?refresh=1' : ''), {
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error('HTTP ' + response.status)
      return response.json()
    }

    // ----------------------------------------------------------------- styles --

    const ellipsis = {
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      maxWidth: '100%',
    }

    const S = {
      root: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
        minWidth: '0',
        maxWidth: '100%',
      },
      panel: {
        position: 'fixed',
        zIndex: 60,
        boxSizing: 'border-box',
        padding: '10px 12px',
        borderRadius: '12px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-overlay)',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.22)',
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'inherit',
        fontSize: '12px',
        lineHeight: '1.4',
        fontVariantNumeric: 'tabular-nums',
        // Interactive on purpose: hovering the panel keeps it open (the wrapper
        // enter cancels the pending close), and its numbers can be selected.
        pointerEvents: 'auto',
        cursor: 'default',
        userSelect: 'text',
      },
      panelHead: {
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: '8px',
      },
      panelTitle: {
        fontSize: '10px',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--dsw-alias-label-secondary)',
      },
      panelAmount: { marginTop: '1px', fontSize: '20px', fontWeight: 600 },
      panelMeta: { marginTop: '1px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' },
      panelRow: {
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: '8px',
      },
      panelLabel: { color: 'var(--dsw-alias-label-secondary)' },
      panelDivider: { height: '1px', margin: '8px 0 7px', background: 'var(--dsw-alias-border-l1)' },
      panelNote: { marginTop: '6px', fontSize: '10px', color: 'var(--dsw-alias-label-secondary)' },
      panelError: { marginTop: '6px', fontSize: '11px', color: 'var(--dsw-alias-state-warn-primary)' },
    }

    function chipStyle(wide) {
      return {
        display: 'inline-flex',
        flexDirection: wide ? 'row' : 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: wide ? '5px' : '0px',
        flex: '0 0 auto',
        minHeight: '28px',
        minWidth: '0',
        maxWidth: '100%',
        padding: wide ? '3px 9px 3px 7px' : '3px 4px',
        borderRadius: '9px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        lineHeight: '1.15',
        cursor: 'pointer',
        boxSizing: 'border-box',
      }
    }

    const dot = (color) => ({
      width: '6px',
      height: '6px',
      flex: '0 0 auto',
      borderRadius: '50%',
      background: color,
    })

    // -------------------------------------------------------------- component --

    /**
     * Contain a hover-panel render failure: the slot retires an entry whose
     * render throws, and the chip must survive a bad tooltip.
     */
    class TipBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }

      static getDerivedStateFromError() {
        return { failed: true }
      }

      componentDidCatch(error) {
        try {
          console.error('[balance-window] info panel failed to render:', error)
        } catch (err) {
          /* nothing left to report to */
        }
      }

      componentDidUpdate(previous) {
        if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false })
      }

      render() {
        return this.state.failed ? null : this.props.children
      }
    }

    /** One sidebar-foot chip, with a hover info panel anchored above it. */
    function BalanceChip(props) {
      const wide = !props || props.wide !== false
      const t = (props && props.t) || ((key) => (DICTS.en[key] === undefined ? key : DICTS.en[key]))
      const [state, setState] = React.useState({ phase: 'loading', data: null, error: null })
      const [open, setOpen] = React.useState(false)
      const [opens, setOpens] = React.useState(0)
      const [anchor, setAnchor] = React.useState(null)
      const rootRef = React.useRef(null)
      const closeTimer = React.useRef(0)
      const inFlight = React.useRef(false)

      const pull = React.useCallback((force) => {
        if (inFlight.current) return
        inFlight.current = true
        readState(force)
          .then((data) => setState({ phase: 'ready', data, error: null }))
          .catch((err) => {
            setState((previous) => ({
              phase: previous.data ? 'ready' : 'error',
              data: previous.data,
              error: err && err.message ? err.message : String(err),
            }))
          })
          .finally(() => {
            inFlight.current = false
          })
      }, [])

      React.useEffect(() => {
        pull(false)
        const timer = window.setInterval(() => {
          if (!document.hidden) pull(false)
        }, POLL_MS)
        const onVisible = () => {
          if (!document.hidden) pull(false)
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          window.clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [pull])

      // The sidebar column clips its content, so the panel is position:fixed and
      // anchored to the chip's viewport rect (the same approach the shipped
      // Cordis footer panel uses in this slot).
      const place = React.useCallback(() => {
        const node = rootRef.current
        if (!node || typeof window === 'undefined') return
        const rect = node.getBoundingClientRect()
        const maxLeft = Math.max(PANEL_GAP, window.innerWidth - PANEL_WIDTH - PANEL_GAP)
        setAnchor({
          left: Math.max(PANEL_GAP, Math.min(rect.left, maxLeft)),
          bottom: Math.max(PANEL_GAP, window.innerHeight - rect.top + PANEL_GAP),
          width: PANEL_WIDTH,
        })
      }, [])

      React.useLayoutEffect(() => {
        if (!open) return undefined
        place()
        window.addEventListener('resize', place)
        return () => window.removeEventListener('resize', place)
      }, [open, place])

      React.useEffect(
        () => () => {
          if (closeTimer.current) window.clearTimeout(closeTimer.current)
        },
        [],
      )

      const show = React.useCallback(() => {
        if (closeTimer.current) {
          window.clearTimeout(closeTimer.current)
          closeTimer.current = 0
        }
        setOpens((count) => count + 1)
        setOpen(true)
      }, [])

      const hide = React.useCallback((delay) => {
        if (closeTimer.current) window.clearTimeout(closeTimer.current)
        closeTimer.current = window.setTimeout(() => {
          closeTimer.current = 0
          setOpen(false)
        }, delay)
      }, [])

      const data = state.data
      const wallets = (data && data.balance && data.balance.wallets) || []
      const wallet = wallets.length ? wallets[0] : null
      const currency = (wallet && wallet.currency) || (data && data.balance && data.balance.currency) || 'USD'
      const healthy = Boolean(wallet)
      const balanceText = wallet
        ? formatMoney(wallet.total, currency)
        : translate(t, state.phase === 'loading' ? 'loading' : 'unavailable')

      const live = data && data.liveTurn
      const last = data && data.turns && data.turns.length ? data.turns[0] : null
      const shown = live || last
      const turnText = shown
        ? (live ? '≈' : '') + formatCost(shown.cost, (last && last.currency) || currency)
        : translate(t, 'unavailable')

      const failure = state.error
        ? translate(t, 'errorGeneric', { message: state.error })
        : data && data.balanceError
          ? data.balanceError.code === 'NO_KEY'
            ? translate(t, 'needKey', { ref: 'DEEPSEEK_API_KEY' })
            : translate(t, 'errorGeneric', { message: data.balanceError.message })
          : null

      const split = []
      if (wallet && typeof wallet.toppedUp === 'number' && wallet.toppedUp > 0) {
        split.push(translate(t, 'toppedUp') + ' ' + formatMoney(wallet.toppedUp, currency))
      }
      if (wallet && typeof wallet.granted === 'number' && wallet.granted > 0) {
        split.push(translate(t, 'granted') + ' ' + formatMoney(wallet.granted, currency))
      }

      const tooltip =
        translate(t, 'aria') +
        '. ' +
        translate(t, 'level', { balance: balanceText }) +
        (split.length ? ' (' + split.join(', ') + ')' : '') +
        (shown
          ? '. ' +
            (live ? translate(t, 'live', { turn: live.turn }) : translate(t, 'last', { turn: last.turn })) +
            ': ' +
            formatCost(shown.cost, (last && last.currency) || currency)
          : '') +
        (failure ? '. ' + failure : '')

      return h(
        'div',
        {
          ref: rootRef,
          style: S.root,
          onMouseEnter: show,
          onMouseLeave: () => hide(CLOSE_DELAY_MS),
        },
        h(
          'button',
          {
            type: 'button',
            style: chipStyle(wide),
            'aria-label': tooltip,
            'aria-describedby': open ? PANEL_ID : undefined,
            'data-balance-window': 'true',
            onClick: () => pull(true),
            onFocus: show,
            onBlur: () => hide(0),
          },
          h('span', { style: dot(healthy ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-warn-primary)'), 'aria-hidden': true }),
          h('span', { style: { ...ellipsis, fontSize: wide ? '12px' : '10px', fontWeight: 600 } }, balanceText),
          h(
            'span',
            {
              style: {
                ...ellipsis,
                fontSize: wide ? '11px' : '9px',
                color: 'var(--dsw-alias-label-secondary)',
                maxWidth: wide ? '96px' : '100%',
              },
            },
            turnText,
          ),
        ),
        open && anchor
          ? h(
              TipBoundary,
              { key: 'tip', resetKey: opens },
              h(
                'div',
                {
                  id: PANEL_ID,
                  role: 'tooltip',
                  style: { ...S.panel, left: anchor.left + 'px', bottom: anchor.bottom + 'px', width: anchor.width + 'px' },
                  'data-balance-window-tip': 'true',
                },
                h(
                  'div',
                  { style: S.panelHead },
                  h('span', { style: S.panelTitle }, translate(t, 'title')),
                ),
                h('div', { style: S.panelAmount }, balanceText),
                split.length ? h('div', { style: S.panelMeta }, split.join(' · ')) : null,

                h('div', { style: S.panelDivider }),
                h(
                  'div',
                  { style: S.panelRow },
                  h('span', { style: S.panelLabel }, live ? translate(t, 'live', { turn: live.turn }) : last ? translate(t, 'last', { turn: last.turn }) : translate(t, 'noTurns')),
                  shown ? h('span', null, (live ? '≈' : '') + formatCost(shown.cost, (last && last.currency) || currency)) : null,
                ),
                shown
                  ? h(
                      'div',
                      { style: S.panelMeta },
                      [
                        translate(t, 'steps', { count: shown.steps || 0 }),
                        formatTokens(shown.tokens) + ' ' + translate(t, 'tokens'),
                        shown.model || null,
                        shown.peak ? translate(t, 'peak') : null,
                      ]
                        .filter(Boolean)
                        .join(' · '),
                    )
                  : null,

                h('div', { style: S.panelDivider }),
                h(
                  'div',
                  { style: S.panelRow },
                  h('span', { style: S.panelLabel }, translate(t, 'today')),
                  data && data.today
                    ? h(
                        'span',
                        null,
                        formatCost(data.today.cost, currency) + ' · ' + translate(t, 'turnsCount', { count: data.today.turns }),
                      )
                    : h('span', { style: S.panelLabel }, translate(t, 'unavailable')),
                ),
                data && data.today && data.today.tokens
                  ? h('div', { style: S.panelMeta }, formatTokens(data.today.tokens) + ' ' + translate(t, 'tokens'))
                  : null,

                failure ? h('div', { style: S.panelError }, failure) : null,
                h(
                  'div',
                  { style: S.panelNote },
                  (data && data.updatedAt ? translate(t, 'updated', { time: formatClock(data.updatedAt) }) + ' · ' : '') +
                    translate(t, 'estimated') +
                    ' · ' +
                    translate(t, 'click'),
                ),
            ),
          )
          : null,
      )
    }

    // ------------------------------------------------------------------ plugin --

    const inject = ['slots', 'locale']

    function apply(ctx) {
      let t = (key) => (DICTS.en[key] === undefined ? key : DICTS.en[key])
      try {
        for (const locale of Object.keys(DICTS)) {
          ctx.locale.register(NS, locale, DICTS[locale])
        }
        t = ctx.locale.bind(NS)
      } catch (err) {
        /* an unregistered namespace falls back to the bundled English copy */
      }

      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          {
            name: 'sidebar.footer.action',
            id: 'balance-window',
            order: 20,
            label: () => translate(t, 'title'),
            locale: NS,
            inject: () => ({ t }),
          },
          BalanceChip,
        ),
      )
    }

    return { inject, apply }
  },
})
