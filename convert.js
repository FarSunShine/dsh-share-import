/**
 * Convert one normalized share conversation into the seed event log of a DSH
 * Session. The mapping mirrors what the DeepSeek export importer writes: each
 * user message opens a turn, each finished reply becomes one or more steps, and
 * the reply's web searches and opened pages replay as `web_search` and
 * `web_fetch` tool calls, so an imported history shows the same cards.
 */

/** One reply under construction: the assistant content plus its tool calls. */
function emptyStep() {
  return { content: [], calls: [], elapsedMs: 0, stage: null }
}

/** Accumulates seed events with contiguous seqs and non-decreasing times. */
class LogBuilder {
  /** @param createId - mints a unique id per message and tool call. */
  constructor(createId) {
    this.createId = createId
    this.events = []
    this.time = 0
  }

  /**
   * Append one event.
   * @param event - event without `seq` and `time`.
   * @returns the seq it was written at.
   */
  add(event) {
    const seq = this.events.length
    this.events.push({ ...event, seq, time: this.time })
    return seq
  }

  /** Never move an event's time backwards. */
  at(time) {
    this.time = Math.max(this.time, Number.isFinite(time) ? time : this.time)
  }

  /**
   * Append one whole turn.
   * @param turn - 1-based turn number.
   * @param user - the user message.
   * @param reply - its reply, when the export has one.
   */
  turn(turn, user, reply) {
    this.at(user.insertedAt)
    this.add({ type: 'turn/start', data: { turn } })
    let step = 1
    this.add({ type: 'step/start', data: { turn, step } })
    if (turn === 1) {
      // The empty system head holds surface node 0 so a resumed Agent replaces it
      // with the real prompt instead of appending a system message after history.
      this.add({
        type: 'system/message',
        data: {
          turn,
          step,
          message: { id: this.createId(), role: 'system', content: [], source: { kind: 'system-prompt' } },
        },
        surfaceOp: 'append',
      })
    }
    // A user event carries the message itself as its data; every other message event wraps it.
    this.add({ type: 'user/message', data: userMessage(this.createId(), user), surfaceOp: 'append' })
    if (reply === undefined) {
      this.closeTurn(turn, step, {
        kind: 'error',
        error: { code: 'SHARE_IMPORT_NO_REPLY', message: 'The share has no reply to this message.' },
      })
      return
    }
    this.at(reply.insertedAt)
    const steps = replySteps(reply, this.createId)
    if (reply.status !== 'FINISHED' || steps.length === 0) {
      this.closeTurn(turn, step, {
        kind: 'error',
        error: {
          code: reply.status === 'FINISHED' ? 'SHARE_IMPORT_EMPTY_REPLY' : 'SHARE_IMPORT_UNFINISHED_REPLY',
          message: reply.status === 'FINISHED'
            ? 'The shared reply has no importable content.'
            : `The shared reply ended with status ${JSON.stringify(reply.status)} and is excluded from the model context.`,
        },
      })
      return
    }
    for (const [position, { content, calls, elapsedMs }] of steps.entries()) {
      if (position > 0) {
        step += 1
        this.add({ type: 'step/start', data: { turn, step } })
      }
      this.time += elapsedMs
      this.add({
        type: 'assistant/message',
        data: {
          turn,
          step,
          message: assistantMessage(this.createId(), [...content, ...calls.map(call => call.block)]),
          stream: [],
        },
        surfaceOp: 'append',
      })
      const callSeqs = calls.map(({ block }) => this.add({
        type: 'tool/call',
        data: { turn, step, callId: block.id, name: block.name, arguments: block.arguments },
      }))
      for (const [callIndex, call] of calls.entries()) {
        this.add({
          type: 'tool/result',
          data: {
            turn,
            step,
            message: toolResult(this.createId(), call),
          },
          surfaceOp: 'append',
          sourceEventSeqs: [callSeqs[callIndex]],
        })
      }
      if (position < steps.length - 1) this.add({ type: 'step/end', data: { turn, step } })
    }
    this.closeTurn(turn, step, { kind: 'completed' })
  }

  /** Close the open step and turn. */
  closeTurn(turn, step, reason) {
    this.add({ type: 'step/end', data: { turn, step } })
    this.add({ type: 'turn/end', data: { turn, reason } })
  }
}

/**
 * Convert one normalized conversation.
 * @param conversation - title plus messages from {@link fetchShareConversation}.
 * @param options - title budget and id source.
 * @returns the title and the seed events, without a `session/end-seed` marker.
 * @throws {Error} when the tree has no importable turn.
 */
export function convertConversation(conversation, options) {
  const chain = selectBranch(conversation)
  const log = new LogBuilder(options.createId)
  const title = options.title ?? null
  let turn = 0
  let withdrawn = 0
  for (let index = 0; index < chain.length; index++) {
    const user = chain[index]
    if (user.role !== 'USER') continue
    const next = chain[index + 1]
    const reply = next?.role === 'ASSISTANT' ? next : undefined
    if (reply !== undefined) index += 1
    if (reply?.status === 'CONTENT_FILTER') {
      withdrawn += 1
      continue
    }
    turn += 1
    log.turn(turn, user, reply)
    if (turn === 1 && title !== null) {
      log.add({ type: 'session/title', data: { title, messageSeqs: [], source: { kind: 'user' } } })
    }
  }
  if (turn === 0) {
    throw new Error(withdrawn === 0 ? 'The share has no question to import.' : 'Every question of the share was withdrawn by content filtering.')
  }
  return { title, createdAt: log.events[0].time, events: log.events, turns: turn }
}

/**
 * Select the imported branch: the path from the root to the deepest message.
 * @param conversation - the normalized conversation.
 * @returns the messages from root to the selected leaf.
 * @throws {Error} for an empty tree, duplicate ids, a missing parent, or a cycle.
 */
export function selectBranch(conversation) {
  const messages = conversation.messages
  const byId = new Map()
  let newest
  for (const message of messages) {
    if (byId.has(message.id)) throw new Error(`duplicate message id ${message.id}`)
    byId.set(message.id, message)
    if (newest === undefined || message.id > newest.id) newest = message
  }
  if (newest === undefined) throw new Error('the conversation has no messages')
  const chain = []
  for (let message = newest; ;) {
    if (chain.length === byId.size) throw new Error(`message ${message.id} is part of a parent cycle`)
    chain.push(message)
    if (message.parentId === null) return chain.reverse()
    const parent = byId.get(message.parentId)
    if (parent === undefined) throw new Error(`message parent ${message.parentId} does not exist`)
    message = parent
  }
}

/** Build one user message: its question text, or an empty block when there is none. */
function userMessage(id, message) {
  const text = message.fragments
    .filter(fragment => fragment.type === 'REQUEST')
    .map(fragment => fragment.content)
    .join('\n')
  return {
    id,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

/** Build one assistant message with the recorded model source. */
function assistantMessage(id, content) {
  return {
    id,
    role: 'assistant',
    content,
    source: { kind: 'model', provider: 'deepseek-share', model: 'deepseek-share' },
  }
}

/** Build one tool result message bound to its call. */
function toolResult(id, call) {
  return {
    id,
    role: 'tool',
    content: call.result,
    isError: call.isError,
    source: { kind: 'tool', callId: call.block.id },
    toolCallId: call.block.id,
  }
}

/**
 * Split one reply into steps. A tool fragment whose `stage` differs from the
 * open step's starts a new step; text after a tool call starts a new step.
 */
function replySteps(reply, createId) {
  const steps = []
  let current = emptyStep()
  const pushStep = () => {
    if (current.content.length === 0 && current.calls.length === 0) return
    steps.push(current)
    current = emptyStep()
  }
  const appendContent = block => {
    if (current.calls.length > 0) pushStep()
    current.content.push(block)
  }
  const appendCall = (call, stage) => {
    if (stage !== null) {
      if (current.stage !== null && stage !== current.stage) pushStep()
      current.stage = stage
    }
    current.calls.push(call)
  }
  for (const fragment of reply.fragments) {
    switch (fragment.type) {
      case 'THINK':
        if (fragment.content.length > 0) appendContent({ type: 'reasoning', text: fragment.content })
        current.elapsedMs += fragment.elapsedMs
        break
      case 'RESPONSE':
        if (fragment.content.length > 0) appendContent({ type: 'text', text: fragment.content })
        break
      case 'TOOL_SEARCH': {
        if (fragment.status === 'WIP') break
        const call = searchCall(createId(), fragment)
        if (call !== undefined) appendCall(call, fragment.stage)
        break
      }
      case 'TOOL_OPEN': {
        if (fragment.status === 'WIP' || fragment.url === null || fragment.url === undefined) break
        appendCall(openCall(createId(), fragment), fragment.stage)
        break
      }
      default:
        break
    }
  }
  pushStep()
  return steps
}

/** Build the `web_search` call and its result text. */
function searchCall(id, fragment) {
  const block = { type: 'tool-call', id, name: 'web_search', arguments: JSON.stringify({ queries: fragment.queries }) }
  if (fragment.status === 'FAILED') {
    return { block, result: [{ type: 'text', text: 'Error: the share records this search as failed.' }], isError: true }
  }
  if (fragment.queries.length === 0) return undefined
  const lines = [`Found ${fragment.results.length} web pages for: ${fragment.queries.join(' | ')}`]
  for (const result of fragment.results) {
    lines.push(`- ${result.title ?? result.url} (${result.url})`)
    if (result.snippet !== undefined) lines.push(`  ${result.snippet}`)
  }
  return { block, result: [{ type: 'text', text: lines.join('\n') }], isError: false }
}

/** Build the `web_fetch` call and its result text. */
function openCall(id, fragment) {
  const block = { type: 'tool-call', id, name: 'web_fetch', arguments: JSON.stringify({ url: fragment.url }) }
  if (fragment.status !== 'FINISHED') {
    return { block, result: [{ type: 'text', text: 'Error: the page could not be opened.' }], isError: true }
  }
  const title = fragment.title === undefined ? '' : `${fragment.title}\n\n`
  return {
    block,
    result: [{ type: 'text', text: `${title}${fragment.url}\n\nThe page body is not part of the share export.` }],
    isError: false,
  }
}
