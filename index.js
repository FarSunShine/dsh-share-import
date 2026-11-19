/**
 * Host half of the share-link import: one exact POST route reads a public
 * chat.deepseek.com share, converts it into a seed log, and stores it as a
 * Session in the Workspace named by the request. Nothing is sent to a model and
 * no turn stays open, so the imported Session is finished history the user can
 * read and continue.
 * @module dsh-share-link-import
 */

import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { convertConversation } from './convert.js'
import { fetchShareConversation, parseShareId, ShareImportError, titleFrom } from './share.js'

/** Exact route below `/api` owned by this plugin. */
const ROUTE = '/api/share-import/run'

/** Services the Host half needs; the projection cache is optional. */
export const inject = ['connection', 'sessionPersistence', 'workspaceRegistry']

/** Cached `@deepseek-ai/dsh-session` module, resolved once on first import. */
let sessionModule

/**
 * Load the Session package the running Harness ships.
 *
 * A profile-installed bundle resolves nothing on its own — but the Harness
 * installation always carries this package, so the fallback resolves it from the
 * installation anchor the Harness reports in `DSH_INSTALL_DIR`.
 * @returns the module namespace with `Session`, `SessionId`, `SESSION_FORMAT_VERSION`, and `SessionLogOffset`.
 * @throws {Error} when neither the bundle nor the installation can provide it.
 */
async function sessionApi() {
  if (sessionModule !== undefined) return sessionModule
  try {
    sessionModule = await import('@deepseek-ai/dsh-session')
    return sessionModule
  } catch (directError) {
    const anchor = process.env.DSH_INSTALL_DIR
    if (typeof anchor === 'string' && anchor.length > 0) {
      try {
        const anchorRequire = createRequire(pathToFileURL(join(anchor, 'package.json')))
        sessionModule = await import(pathToFileURL(anchorRequire.resolve('@deepseek-ai/dsh-session')).href)
        return sessionModule
      } catch (anchorError) {
        throw new Error(`cannot load @deepseek-ai/dsh-session: ${directError.message}; from the installation: ${anchorError.message}`)
      }
    }
    throw new Error(`cannot load @deepseek-ai/dsh-session: ${directError.message}`)
  }
}

/**
 * Read the row config with defaults, refusing values that cannot work.
 * @param config - the row's `config` object.
 * @returns normalized limits.
 */
function readConfig(config) {
  const source = config ?? {}
  const positive = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback)
  return {
    maxResults: Math.floor(positive(source.maxSearchResults, 8)),
    snippetChars: Math.floor(positive(source.snippetChars, 120)),
    maxTitleBytes: Math.floor(positive(source.maxTitleBytes, 80)),
    timeoutMs: Math.floor(positive(source.timeoutMs, 60_000)),
  }
}

/**
 * Mount the route.
 * @param ctx - Host plugin context.
 * @param config - row config from the patch.
 * @returns nothing; the route is registered as an effect.
 */
export function apply(ctx, config) {
  const limits = readConfig(config)
  /** The single import slot: a second concurrent request answers `busy`. */
  let busy = false

  /**
   * Serve one import request.
   * @param request - the submitted Fetch request carrying JSON `{ url, workspaceId }`.
   * @returns the JSON envelope the dialog renders.
   */
  const handler = async request => {
    if (request.method !== 'POST') return json({ ok: false, error: { reason: 'method', message: 'POST only' } }, 405)
    let body
    try {
      body = await request.json()
    } catch {
      return json({ ok: false, error: { reason: 'bad-request', message: 'The request body is not JSON.' } }, 400)
    }
    const workspaceId = typeof body?.workspaceId === 'string' ? body.workspaceId : ''
    const workspace = workspaceId.length === 0 ? undefined : ctx.workspaceRegistry.get(workspaceId)
    if (workspace === undefined) {
      return json({ ok: false, error: { reason: 'workspace-not-found', message: `Workspace ${workspaceId} does not exist.` } }, 404)
    }
    if (busy) return json({ ok: false, error: { reason: 'busy', message: 'Another share import is already running.' } }, 409)
    busy = true
    try {
      const shareId = parseShareId(body?.url)
      const conversation = await fetchShareConversation(shareId, limits, request.signal)
      const title = titleFrom(conversation.messages.find(message => message.role === 'USER')?.fragments?.[0]?.content, limits.maxTitleBytes)
        ?? titleFrom('Shared conversation', limits.maxTitleBytes)
      const converted = convertConversation(conversation, { createId: () => randomUUID(), title })
      const sessionId = await writeSession(ctx, converted, workspace, request.signal)
      ctx.logger.info(`share-import: imported share ${shareId} as session ${sessionId} (${converted.turns} turns)`)
      return json({ ok: true, value: { sessionId, title: converted.title, turns: converted.turns, shareId } })
    } catch (error) {
      if (request.signal.aborted) return json({ ok: false, error: { reason: 'cancelled', message: 'The import was cancelled.' } }, 499)
      const reason = error instanceof ShareImportError ? error.reason : 'import-failed'
      ctx.logger.warn(`share-import: ${reason}: ${messageOf(error)}`)
      return json({ ok: false, error: { reason, message: messageOf(error) } }, 200)
    } finally {
      busy = false
    }
  }

  ctx.effect(
    () => ctx.connection.fetch.register({ path: ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: handler }),
    'share-import: run route',
  )
}

/**
 * Store one converted conversation and attach it to its Workspace.
 * @param ctx - Host plugin context.
 * @param converted - title, creation time, turns, and seed events.
 * @param workspace - the target Workspace.
 * @param signal - request cancellation.
 * @returns the new Session id.
 * @throws {Error} naming the failed step.
 */
async function writeSession(ctx, converted, workspace, signal) {
  const { Session, SessionId, SessionLogOffset, SESSION_FORMAT_VERSION } = await sessionApi()
  const id = SessionId(randomUUID())
  const header = { version: SESSION_FORMAT_VERSION, id, createdAt: converted.createdAt, cwd: workspace.path, isSeeded: false }
  // Construction runs the same seed validation as a live Session; the instance is not kept.
  try {
    Session.create(id, converted.events, header)
  } catch (error) {
    throw new Error(`the converted history is not a valid Session seed: ${messageOf(error)}`)
  }
  signal.throwIfAborted()
  const handle = await ctx.sessionPersistence.create(header, { signal })
  try {
    await handle.append(converted.events)
    await handle.flush()
  } finally {
    await handle.close()
  }
  ctx.get('sessionProjectionCache')?.coldSnapshot(header, SessionLogOffset(0), converted.events)
  try {
    await workspace.attachSession(id)
  } catch (error) {
    throw new Error(`stored as Session ${id} but not added to the workspace: ${messageOf(error)}`)
  }
  return id
}

/**
 * Build one JSON response.
 * @param payload - JSON-serializable body.
 * @param status - HTTP status.
 * @returns the Fetch response.
 */
function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** Describe one thrown value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
