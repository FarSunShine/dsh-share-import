/**
 * Offline self-test: normalize a saved share answer, convert it, and run the
 * same seed validation a stored Session goes through. Run with the DSH node:
 *   ELECTRON_RUN_AS_NODE=1 "<DSH_NODE_EXECUTABLE>" tools/selftest.mjs <raw.json>
 */
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { convertConversation } from '../convert.js'
import { normalizeSharePayload, parseShareId, titleFrom } from '../share.js'

const rawPath = process.argv[2]
const payload = JSON.parse(fs.readFileSync(rawPath, 'utf8'))
const limits = { maxResults: 8, snippetChars: 120, maxTitleBytes: 80, timeoutMs: 60_000 }

console.log('parseShareId:', parseShareId('https://chat.deepseek.com/share/1dxh5vdk8e3xkja315'))
console.log('parseShareId bare:', parseShareId('1dxh5vdk8e3xkja315'))
for (const bad of ['https://example.com/share/abc123', 'not a link', '']) {
  try { parseShareId(bad); console.log('UNEXPECTEDLY ACCEPTED:', bad) } catch (error) { console.log('rejected:', JSON.stringify(bad), '->', error.reason) }
}

const conversation = normalizeSharePayload(payload, limits, '1dxh5vdk8e3xkja315')
const title = titleFrom(conversation.messages.find(m => m.role === 'USER')?.fragments?.[0]?.content, limits.maxTitleBytes)
const converted = convertConversation(conversation, { createId: () => randomUUID(), title })
console.log('title:', converted.title, '/ bytes:', Buffer.byteLength(converted.title ?? '', 'utf8'))
console.log('turns:', converted.turns, 'events:', converted.events.length, 'createdAt:', new Date(converted.createdAt).toISOString())

const kinds = new Map()
for (const event of converted.events) kinds.set(event.type, (kinds.get(event.type) ?? 0) + 1)
console.log('event kinds:', Object.fromEntries(kinds))

const seqsOk = converted.events.every((event, index) => event.seq === index)
const timeOk = converted.events.every((event, index) => index === 0 || event.time >= converted.events[index - 1].time)
console.log('seq contiguous:', seqsOk, 'time non-decreasing:', timeOk)

let problem = null
try {
  const session = await import('file:///C:/Users/SUNSHINE/AppData/Local/Programs/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js')
  const id = session.SessionId(randomUUID())
  const header = { version: session.SESSION_FORMAT_VERSION, id, createdAt: converted.createdAt, cwd: process.cwd(), isSeeded: false }
  session.Session.create(id, converted.events, header)
  console.log('Session.create validation: ok')
} catch (error) {
  problem = error
  console.log('Session.create validation: FAILED -', error.message)
}

const firstTurn = converted.events.find(e => e.type === 'turn/start')
console.log('first turn/start:', JSON.stringify(firstTurn))
const titleEvent = converted.events.find(e => e.type === 'session/title')
console.log('session/title at seq', titleEvent?.seq, ':', titleEvent?.data.title)
process.exitCode = problem === null ? 0 : 1
