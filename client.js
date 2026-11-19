/**
 * Browser half of the share-link import: one small action after the New-session
 * row that opens a dialog asking for a public share link and a target Workspace.
 * The dialog posts to the Host route and refreshes the Session list afterwards,
 * so the imported Session appears without a reload.
 */

window.__ModuleLoader__.load({
  id: 'dsh-share-link-import',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace of this plugin. */
    const NS = 'dshShareImport'

    /** Chinese copy. */
    const zh = {
      'action.label': '从分享链接导入',
      'dialog.title': '从分享链接导入',
      'dialog.description': '粘贴一个公开的 chat.deepseek.com 分享链接，把它存成当前工作区里的会话。',
      'dialog.link': '分享链接',
      'dialog.linkPlaceholder': 'https://chat.deepseek.com/share/…',
      'dialog.workspace': '工作区',
      'dialog.cancel': '取消',
      'dialog.import': '导入',
      'dialog.importing': '正在导入…',
      'dialog.close': '关闭',
      'result.imported': '已导入「{title}」，共 {count} 轮问答。',
      'result.open': '在侧栏中找到它即可继续对话。',
      'error.no-workspace': '还没有可用的工作区，请先在侧栏创建一个。',
    }

    /** English copy. */
    const en = {
      'action.label': 'Import from share link',
      'dialog.title': 'Import from a share link',
      'dialog.description': 'Paste a public chat.deepseek.com share link to store it as a Session in a workspace.',
      'dialog.link': 'Share link',
      'dialog.linkPlaceholder': 'https://chat.deepseek.com/share/…',
      'dialog.workspace': 'Workspace',
      'dialog.cancel': 'Cancel',
      'dialog.import': 'Import',
      'dialog.importing': 'Importing…',
      'dialog.close': 'Close',
      'result.imported': 'Imported “{title}” with {count} turns.',
      'result.open': 'Find it in the sidebar and continue the conversation.',
      'error.no-workspace': 'No workspace is available yet. Create one in the sidebar first.',
    }

    /**
     * Trigger styling: a quiet icon button sized like the neighbouring row
     * controls, so it sits in the New-session row instead of reading as text.
     */
    const TRIGGER_CSS = `
.dsh-sli-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  margin-left: 4px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: .72;
  transition: background-color .15s ease, opacity .15s ease;
}
.dsh-sli-trigger:hover { background: rgba(128,128,128,.16); opacity: 1; }
.dsh-sli-trigger:active { background: rgba(128,128,128,.26); }
.dsh-sli-trigger:focus-visible { outline: 2px solid #3A82F7; outline-offset: 2px; }
.dsh-sli-trigger.is-narrow { width: 34px; height: 34px; }
`

    /**
     * The link glyph: two chain links, drawn with the current text colour so it
     * follows the theme.
     * @param props - `size` in pixels.
     */
    function LinkIcon(props) {
      const size = props?.size ?? 16
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, focusable: 'false',
      },
      h('path', { d: 'M10.4 13.6a4.3 4.3 0 0 0 6.1 0l2.3-2.3a4.3 4.3 0 0 0-6.1-6.1l-1.1 1.1' }),
      h('path', { d: 'M13.6 10.4a4.3 4.3 0 0 0-6.1 0l-2.3 2.3a4.3 4.3 0 0 0 6.1 6.1l1.1-1.1' }))
    }

    /** Shared control styling; colours come from the page so both themes work. */
    const inputStyle = {
      width: '100%',
      boxSizing: 'border-box',
      padding: '6px 8px',
      borderRadius: 6,
      border: '1px solid rgba(128,128,128,.45)',
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
      outline: 'none',
    }

    const buttonStyle = {
      padding: '6px 12px',
      borderRadius: 6,
      border: '1px solid rgba(128,128,128,.45)',
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
      cursor: 'pointer',
    }

    const primaryStyle = {
      ...buttonStyle,
      border: '1px solid transparent',
      background: '#3A82F7',
      color: '#fff',
      fontWeight: 600,
    }

    /**
     * The dialog: link, workspace, submit, result.
     * @param props - `t`, workspace hook, the Host round trip, and `onClose`.
     */
    function ImportDialog(props) {
      const { t, useWorkspaces, runImport, onClose } = props
      const workspaces = typeof useWorkspaces === 'function' ? useWorkspaces(state => state.items) : []
      const [url, setUrl] = React.useState('')
      const [workspaceId, setWorkspaceId] = React.useState(workspaces[0]?.workspaceId)
      const [state, setState] = React.useState({ phase: 'editing' })
      const request = React.useRef(null)
      React.useEffect(() => () => { request.current?.abort() }, [])
      const running = state.phase === 'running'
      const target = workspaces.find(item => item.workspaceId === workspaceId) ?? workspaces[0]
      const close = () => { request.current?.abort(); onClose() }

      const submit = () => {
        if (target === undefined || url.trim().length === 0) return
        const controller = new AbortController()
        request.current = controller
        setState({ phase: 'running' })
        runImport(url.trim(), target.workspaceId, controller.signal).then((outcome) => {
          if (controller.signal.aborted) return
          setState(outcome.ok
            ? { phase: 'done', value: outcome.value }
            : { phase: 'editing', error: outcome.error })
        }, (error) => {
          if (controller.signal.aborted) return
          setState({ phase: 'editing', error: { reason: 'unknown', message: error instanceof Error ? error.message : String(error) } })
        })
      }

      const body = state.phase === 'done'
        ? h('div', { role: 'status', style: { display: 'grid', gap: 6 } },
          h('p', { style: { margin: 0 } }, t('result.imported', { title: state.value.title ?? '', count: String(state.value.turns) })),
          h('p', { style: { margin: 0, opacity: .75 } }, t('result.open')))
        : h('div', { style: { display: 'grid', gap: 12 } },
          h('label', { style: { display: 'grid', gap: 4 } },
            h('span', { style: { fontSize: 12, opacity: .75 } }, t('dialog.link')),
            h('input', {
              type: 'url',
              value: url,
              placeholder: t('dialog.linkPlaceholder'),
              autoFocus: true,
              spellCheck: false,
              disabled: running,
              style: inputStyle,
              onChange: event => setUrl(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Enter') submit() },
            })),
          h('label', { style: { display: 'grid', gap: 4 } },
            h('span', { style: { fontSize: 12, opacity: .75 } }, t('dialog.workspace')),
            workspaces.length === 0
              ? h('span', { style: { fontSize: 13, color: '#d9534f' } }, t('error.no-workspace'))
              : h('select', {
                value: target?.workspaceId ?? '',
                disabled: running,
                style: inputStyle,
                onChange: event => setWorkspaceId(event.target.value),
              }, workspaces.map(item => h('option', { key: item.workspaceId, value: item.workspaceId }, item.title ?? item.workspaceId)))),
          state.error !== undefined
            ? h('div', { role: 'alert', style: { fontSize: 13, color: '#d9534f', whiteSpace: 'pre-wrap' } },
              state.error.message ?? state.error.reason)
            : null)

      const footer = state.phase === 'done'
        ? h('button', { type: 'button', style: primaryStyle, onClick: close }, t('dialog.close'))
        : h(React.Fragment, null,
          h('button', { type: 'button', style: buttonStyle, onClick: close }, t('dialog.cancel')),
          h('button', {
            type: 'button',
            style: { ...primaryStyle, opacity: running || target === undefined || url.trim().length === 0 ? .55 : 1 },
            disabled: running || target === undefined || url.trim().length === 0,
            onClick: submit,
          }, running ? t('dialog.importing') : t('dialog.import')))

      return h('div', {
        style: {
          position: 'fixed', inset: 0, zIndex: 2000, display: 'flex',
          alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.35)',
        },
        onMouseDown: event => { if (event.target === event.currentTarget) close() },
      }, h('div', {
        role: 'dialog',
        'aria-modal': true,
        'aria-label': t('dialog.title'),
        style: {
          width: 420, maxWidth: 'calc(100vw - 32px)', padding: 20, borderRadius: 12, display: 'grid', gap: 14,
          background: 'Canvas', color: 'CanvasText', border: '1px solid rgba(128,128,128,.35)',
          boxShadow: '0 16px 48px rgba(0,0,0,.35)',
        },
      },
      h('div', { style: { display: 'grid', gap: 4 } },
        h('strong', { style: { fontSize: 15 } }, t('dialog.title')),
        h('span', { style: { fontSize: 12, opacity: .75, lineHeight: 1.5 } }, t('dialog.description'))),
      body,
      h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 } }, footer)))
    }

    /**
     * The row layer: the New-session content unchanged, then the trigger and,
     * while open, its dialog.
     * @param props - the row content, the width flag, locale seat, and injected operations.
     */
    function ShareImportAction(props) {
      const { children, wide, t, runImport } = props
      const [open, setOpen] = React.useState(false)
      return h(React.Fragment, null,
        children,
        h('button', {
          type: 'button',
          className: wide ? 'dsh-sli-trigger' : 'dsh-sli-trigger is-narrow',
          title: t('action.label'),
          'aria-label': t('action.label'),
          onClick: () => setOpen(true),
        }, h(LinkIcon, { size: wide ? 16 : 18 })),
        open ? h(ImportDialog, { ...props, onClose: () => setOpen(false) }) : null)
    }

    return {
      inject: ['slots', 'sessions', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'share-import: dictionaries')
        // One stylesheet for the trigger; the id guard keeps HMR reloads from stacking copies.
        ctx.effect(() => {
          const existing = document.getElementById('dsh-share-link-import-style')
          if (existing !== null) return () => {}
          const style = document.createElement('style')
          style.id = 'dsh-share-link-import-style'
          style.textContent = TRIGGER_CSS
          document.head.appendChild(style)
          return () => { style.remove() }
        }, 'share-import: trigger styles')
        const injected = {
          runImport: async (url, workspaceId, signal) => {
            try {
              const endpoint = new URL('api/share-import/run', document.baseURI)
              const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ url, workspaceId }),
                credentials: 'same-origin',
                signal,
              })
              return await response.json()
            } catch (error) {
              if (signal.aborted) return { ok: false, error: { reason: 'cancelled', message: 'cancelled' } }
              return { ok: false, error: { reason: 'network', message: error instanceof Error ? error.message : String(error) } }
            } finally {
              // A stored Session is written without a live Agent, so the list learns of it by reloading.
              await ctx.sessions.refresh().catch(error => { ctx.logger.warn('share-import: session list refresh failed', error) })
            }
          },
        }
        ctx.slots.inject('sidebar.session.action', () => ctx.slots.register({
          name: 'sidebar.session.action',
          id: 'share-import',
          locale: NS,
          inject: () => injected,
        }, ShareImportAction))
      },
    }
  },
})
