// =====================================================================
// compact 会话压缩插件 —— Client 半（动态 Cordis 插件）
// 功能：会话输入栏左侧「压缩」按钮，点击即触发一次手动压缩
//       （host.call('compact/run') → Host 复用引擎 compaction 服务）
// =====================================================================
return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    // 组件函数在 apply 作用域定义一次，保证 React hooks 身份稳定
    function CompactButton(props) {
      const state = React.useState({ phase: 'idle', text: '' })
      const phase = state[0].phase
      const text = state[0].text
      const setState = state[1]
      const sessionId = props.sessionId

      const label = phase === 'running' ? '压缩中…' : (text ? '✓ ' + text : '压缩')
      const onClick = () => {
        if (phase === 'running') return
        setState({ phase: 'running', text: '' })
        host.call('compact/run', { sessionId }).then((r) => {
          const message = (r && r.ok)
            ? String(r.message || '已压缩')
            : '失败：' + String((r && r.error) || '未知错误')
          setState({ phase: 'idle', text: message })
        }).catch((e) => {
          setState({ phase: 'idle', text: '失败：' + String((e && e.message) || e) })
        })
      }

      return React.createElement(
        'button',
        {
          className: 'crcompact-btn',
          title: '压缩当前会话：早期消息折叠为摘要（等价 /compact），显著节省 token，已压缩内容无法原样找回',
          onClick,
          disabled: phase === 'running',
        },
        label
      )
    }

    slots.inject('conversation.input.left', () => slots.register(
      { name: 'conversation.input.left', id: 'compact-btn', order: 95, label: '压缩' },
      (props) => React.createElement(CompactButton, props)
    ))

    styles.insert(
      '.crcompact-btn{' +
      '  margin-left: 6px; padding: 2px 8px; border: 1px solid var(--dsh-color-border, rgba(128,128,128,.35));' +
      '  border-radius: 6px; background: transparent; color: inherit; font-size: 12px; line-height: 1.6; cursor: pointer; white-space: nowrap;' +
      '}' +
      '.crcompact-btn:hover{ background: var(--dsh-color-surface-hover, rgba(128,128,128,.12)); }' +
      '.crcompact-btn:disabled{ opacity: .55; cursor: default; }'
    )
  },
}