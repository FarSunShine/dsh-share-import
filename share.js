/**
 * Read one public DeepSeek share link: `https://chat.deepseek.com/share/<id>`
 * resolves through the site's own read-only endpoint
 * `/api/v0/share/content?share_id=<id>`, which needs no credentials. The answer
 * is normalized into the message/fragment shapes the local converter consumes,
 * so nothing downstream depends on the site's extra fields.
 */

/** The share endpoint; `share_id` is the last path segment of a share link. */
const SHARE_ENDPOINT = 'https://chat.deepseek.com/api/v0/share/content'

/** A browser-like agent: the endpoint answers 429 to a bare script user agent. */
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** A share id as the site mints it: URL-safe and never empty. */
const SHARE_ID = /^[A-Za-z0-9_-]{6,64}$/u

/** Failure carrying one of the reasons the route reports to the dialog. */
export class ShareImportError extends Error {
  /**
   * @param reason - stable reason code shown by the dialog.
   * @param message - diagnostic text; the dialog shows it too.
   */
  constructor(reason, message) {
    super(message)
    this.name = 'ShareImportError'
    this.reason = reason
  }
}

/**
 * Accept a share link, a `chat.deepseek.com` link without the scheme, or a bare
 * id. Anything else is refused before a request is made.
 * @param input - link or id typed into the dialog.
 * @returns the share id.
 * @throws {ShareImportError} `invalid-link` when no share id can be read.
 */
export function parseShareId(input) {
  const text = typeof input === 'string' ? input.trim() : ''
  if (text.length === 0) throw new ShareImportError('invalid-link', 'The share link is empty.')
  if (SHARE_ID.test(text)) return text
  let url
  try {
    url = new URL(/^[a-z]+:\/\//iu.test(text) ? text : `https://${text}`)
  } catch {
    throw new ShareImportError('invalid-link', `Not a share link: ${text}`)
  }
  const segments = url.pathname.split('/').filter(segment => segment.length > 0)
  const shareIndex = segments.indexOf('share')
  const id = shareIndex >= 0 ? segments[shareIndex + 1] : segments[0]
  if (url.hostname !== 'chat.deepseek.com' || id === undefined || !SHARE_ID.test(id)) {
    throw new ShareImportError('invalid-link', 'Only https://chat.deepseek.com/share/<id> links can be imported.')
  }
  return id
}

/**
 * Fetch and normalize one share.
 * @param shareId - id from {@link parseShareId}.
 * @param limits - result and snippet limits applied while normalizing.
 * @param signal - cancellation from the request.
 * @returns the title and the message chain, oldest first.
 * @throws {ShareImportError} `fetch-failed`, `share-unavailable`, or `empty-share`.
 */
export async function fetchShareConversation(shareId, limits, signal) {
  const endpoint = `${SHARE_ENDPOINT}?share_id=${encodeURIComponent(shareId)}`
  let response
  try {
    response = await fetch(endpoint, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(limits.timeoutMs)]),
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new ShareImportError('fetch-failed', `Could not reach chat.deepseek.com: ${messageOf(error)}`)
  }
  if (!response.ok) {
    throw new ShareImportError(
      response.status === 429 ? 'rate-limited' : 'share-unavailable',
      `chat.deepseek.com answered HTTP ${response.status} for share ${shareId}`,
    )
  }
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    throw new ShareImportError('share-unavailable', `The share answer is not JSON: ${messageOf(error)}`)
  }
  return normalizeSharePayload(payload, limits, shareId)
}

/**
 * Turn one decoded share answer into the normalized conversation.
 * @param payload - the endpoint's JSON body.
 * @param limits - result and snippet limits.
 * @param shareId - id the answer was requested for, echoed into the result.
 * @returns the title and normalized messages.
 * @throws {ShareImportError} `empty-share` when the answer carries no conversation.
 */
export function normalizeSharePayload(payload, limits, shareId) {
  const data = payload?.data?.biz_data
  const messages = Array.isArray(data?.messages) ? data.messages : []
  if (payload?.code !== 0 || data === undefined || data === null || messages.length === 0) {
    throw new ShareImportError('empty-share', `Share ${shareId} has no readable conversation.`)
  }
  return {
    title: typeof data.title === 'string' ? data.title : null,
    messages: messages.map(message => normalizeMessage(message, limits)),
    shareId,
  }
}

/**
 * Map one site message onto the local message shape.
 * @param message - one entry of `biz_data.messages`.
 * @param limits - result and snippet limits.
 * @returns the normalized message.
 */
function normalizeMessage(message, limits) {
  return {
    id: message.message_id,
    parentId: message.parent_id ?? null,
    role: message.role,
    status: typeof message.status === 'string' ? message.status : 'FINISHED',
    insertedAt: Math.round(Number(message.inserted_at ?? 0) * 1000),
    fragments: (message.fragments ?? []).map(fragment => normalizeFragment(fragment, limits)).filter(fragment => fragment !== undefined),
  }
}

/**
 * Map one site fragment onto a fragment type the converter maps.
 * @param fragment - one entry of `message.fragments`.
 * @param limits - result and snippet limits.
 * @returns the normalized fragment, or undefined for a record the site shows but the import drops.
 */
function normalizeFragment(fragment, limits) {
  switch (fragment.type) {
    case 'REQUEST':
    case 'RESPONSE':
      return { type: fragment.type, content: String(fragment.content ?? '') }
    case 'THINK':
      return {
        type: 'THINK',
        content: String(fragment.content ?? ''),
        elapsedMs: Math.round(Number(fragment.elapsed_secs ?? 0) * 1000),
      }
    case 'TOOL_SEARCH':
      return {
        type: 'TOOL_SEARCH',
        status: String(fragment.status ?? 'FINISHED'),
        queries: (fragment.queries ?? [])
          .map(query => (typeof query === 'string' ? query : query?.query))
          .filter(query => typeof query === 'string' && query.trim().length > 0),
        results: (fragment.results ?? []).slice(0, limits.maxResults).map(result => ({
          url: String(result.url ?? ''),
          title: clip(result.title, 200),
          snippet: clip(result.snippet, limits.snippetChars),
          publishedAt: result.published_at == null ? undefined : new Date(Number(result.published_at) * 1000).toISOString(),
        })),
        stage: Number.isInteger(fragment.stage_id) ? fragment.stage_id : null,
      }
    case 'TOOL_OPEN': {
      const result = fragment.result ?? {}
      return {
        type: 'TOOL_OPEN',
        status: String(fragment.status ?? 'FINISHED'),
        url: typeof result.url === 'string' && result.url.trim().length > 0 ? result.url : null,
        title: clip(result.title, 200),
        stage: Number.isInteger(fragment.stage_id) ? fragment.stage_id : null,
      }
    }
    default:
      return undefined
  }
}

/**
 * Collapse whitespace and cut one string to a code-point bound.
 * @param value - source text.
 * @param max - longest accepted code-point count.
 * @returns the cleaned text, or undefined when nothing remains.
 */
export function clip(value, max) {
  if (typeof value !== 'string') return undefined
  const clean = value.replace(/\s+/gu, ' ').trim()
  if (clean.length === 0) return undefined
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

/**
 * Truncate a title to a UTF-8 byte budget without splitting a code point.
 * @param text - title candidate.
 * @param maxBytes - UTF-8 byte budget.
 * @returns the title, or undefined when it collapses to nothing.
 */
export function titleFrom(text, maxBytes) {
  const clean = typeof text === 'string' ? text.replace(/\s+/gu, ' ').trim() : ''
  if (clean.length === 0) return undefined
  const encoder = new TextEncoder()
  let bytes = 0
  let out = ''
  for (const character of clean) {
    const size = encoder.encode(character).length
    if (bytes + size > maxBytes) break
    bytes += size
    out += character
  }
  return out.length === 0 ? undefined : out
}

/**
 * Report one unknown thrown value as text.
 * @param error - thrown value.
 * @returns its message.
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
