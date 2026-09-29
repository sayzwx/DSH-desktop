/**
 * 会话事件 seq 水位：引擎契约里「seq 是会话内唯一且单调递增」，重复投递必须按 seq 丢弃。
 *
 * 为什么需要它 ——
 * 桌面端此前只靠 DOM 身份去重（chat.js 的 renderedIds / msgIdentity，依据 ev.data.id /
 * messageId / provenance.seq）。那套机制覆盖不到**不带消息 id 的事件**：turn/end（回合成
 * 交框）、permission/preset / sandbox/mode / approval/policy（三条权限告警条）、tool/call、
 * hook/* 等等。一旦同一帧被投递两次，界面就出现「每条消息正好两份」的重复框 —— 现象是
 * 用户看到的重复气泡、重复告警条、重复回合统计框。
 *
 * 引擎侧本来就给了判据：SessionEvent 一定带 seq
 * （packages/core/session/src/types.ts：Monotonic sequence number within the session；
 *  同包 invariant.ts 强制 `seq must strictly increase`）。官方 Web 客户端正是按它去重的
 * （packages/client/runtime/src/client/sessions/session.ts appendLive：
 *  `if (tailSeq !== null && event.seq <= tailSeq) return 'none' // replay overlap, drop`）。
 * 桌面端缺的就是这一层。
 *
 * 判据刻意做成「这个 seq 是否已经应用过」，而不是「seq 是否大于水位」——
 * 两条连接交错投递时会出现 5,6,7,5,6,7 甚至 6,5,7,6 这类乱序；纯水位会把后到的 5 当成
 * 重复丢掉，而那一条其实从未应用过（丢消息比重复更糟）。记录集合 + 只丢弃「确实见过」的
 * seq，任何到达顺序都既不丢事件也不重复应用。
 *
 * 对外接口：window.__eventSeq = { create }
 *   create() 返回 { accept(seq), watermark, size }：
 *   accept 返回 false 表示这一帧是重复投递、调用方应直接丢弃；true 表示首次到达（已记账）。
 *   非数字 seq 一律接受 —— 没有判据就不要猜，交给调用方原有的身份去重。
 */
(function () {
  // 尾部窗口：只保留最近这段 seq 供去重判定。引擎按 seq 顺序推送，「重复投递」只会落在
  // 刚刚收到的那一段里，远早于窗口的旧 seq 不可能再作为重复帧出现，删掉即可，集合大小
  // 稳定在 KEEP_TAIL 量级（长会话不涨内存）。
  const KEEP_TAIL = 4096;

  function create() {
    const seen = new Set();
    let max = -1;
    return {
      accept(seq) {
        if (typeof seq !== 'number' || !Number.isFinite(seq)) return true;
        if (seen.has(seq)) return false;
        seen.add(seq);
        if (seq > max) max = seq;
        if (seen.size > KEEP_TAIL * 2) {
          const floor = max - KEEP_TAIL;
          for (const q of seen) if (q < floor) seen.delete(q);
        }
        return true;
      },
      get watermark() { return max; },
      get size() { return seen.size; },
    };
  }

  window.__eventSeq = { create };
})();
