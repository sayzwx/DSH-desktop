// =====================================================================
// compact 会话压缩插件 —— Host 半（动态 Cordis 插件）
// 功能：compact 工具（模型可调用，一句话触发，等价 /compact）
//       + compact/run RPC（供 Client 输入栏按钮调用）
// 底层复用引擎 compaction 服务（与内置 /compact 命令同一实现）。
// =====================================================================
return {
  inject: ['compaction'],
  apply(ctx) {
    // ============ 1) compact 工具：模型可直接调用（Web / 桌面端聊天一句话触发，等价 /compact）============
    harness.registerTool(ctx, {
      name: 'compact',
      description: '手动压缩当前会话的早期历史为一条摘要（等价于在输入框输入 /compact，与 opencode 的 /compact 同款能力）。压缩后较早的消息被替换为摘要节点，后续请求不再携带原始消息，显著降低 token 用量。引擎另有自动压缩策略，一般无需手动调用；仅当用户明确要求压缩、或上下文接近上限时使用。',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            compacted: { type: 'boolean' },
            items: { type: 'number' },
            tokens: { type: 'number' },
            message: { type: 'string' },
            error: { type: 'string' },
          },
          required: ['ok'],
          additionalProperties: false,
        },
        render(args, value) {
          return [{ type: 'text', text: JSON.stringify(value) }]
        },
      },
      execute: async (args, exec) => {
        const agent = exec.agent
        if (agent === undefined) return { ok: false, error: '当前没有活动的会话上下文' }
        try {
          const result = await ctx.compaction.compactNow(agent, exec.signal)
          if (result === null) return { ok: true, compacted: false, message: '当前没有可压缩的历史' }
          return {
            ok: true,
            compacted: true,
            items: result.shadowedSeqs.length,
            tokens: result.shadowedTokenCount,
            message: '已压缩 ' + result.shadowedSeqs.length + ' 条历史（约 ' + result.shadowedTokenCount + ' tokens）',
          }
        } catch (error) {
          if (exec.signal.aborted) return { ok: false, error: '压缩已取消' }
          return { ok: false, error: String(error && error.message || error) }
        }
      },
    })

    // ============ 2) RPC compact/run：Client 输入栏按钮调用 ============
    // 动态沙箱没有 AbortSignal 构造器，真实 signal 由 agent.runMaintenance 注入。
    harness.handle('compact/run', async (args) => {
      const sessionId = args && args.sessionId
      const agents = ctx.get('agents')
      const agent = (agents && sessionId) ? agents.get(sessionId) : undefined
      if (agent === undefined) return { ok: false, error: '找不到该会话，可能已关闭' }
      try {
        const result = await agent.runMaintenance(async (signal) => {
          return await ctx.compaction.compactNow(agent, signal)
        })
        if (result === null) return { ok: true, compacted: false, message: '当前没有可压缩的历史' }
        return {
          ok: true,
          compacted: true,
          items: result.shadowedSeqs.length,
          tokens: result.shadowedTokenCount,
          message: '已压缩 ' + result.shadowedSeqs.length + ' 条历史（约 ' + result.shadowedTokenCount + ' tokens）',
        }
      } catch (error) {
        return { ok: false, error: String(error && error.message || error) }
      }
    })
  },
}