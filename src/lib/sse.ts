// Server-Sent Events response with a built-in heartbeat.
//
// Behind a proxy with an idle timeout (Cloudflare's free plan closes a
// request that sends nothing for 100 seconds), a long AI call must keep bytes
// flowing on the SAME response. This sends `{"ping":true}` every
// `heartbeatMs` while `run` works, then whatever `run` sends (normally one
// final `{done:true, …}`). An exception thrown by `run` becomes a final
// `{error}` event — by then the HTTP status is already 200, so errors that
// need a real status code (auth, permissions, budget) must be checked BEFORE
// calling this.
//
// Same wire format as every other streaming route in the app
// (`data: <json>\n\n`), so the existing client readers work unchanged.

export type SseSend = (payload: unknown) => void

export function sseResponse(
  run: (send: SseSend) => Promise<void>,
  opts: { heartbeatMs?: number; errorMessage?: string } = {},
): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      const send: SseSend = (payload) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
        } catch {
          closed = true // client went away; keep working, the result is persisted
        }
      }
      const heartbeat = setInterval(() => send({ ping: true }), opts.heartbeatMs ?? 10_000)
      try {
        await run(send)
      } catch (err) {
        console.error('[sse] stream handler failed:', err)
        send({ error: opts.errorMessage || (err instanceof Error ? err.message : 'Something went wrong') })
      } finally {
        clearInterval(heartbeat)
        if (!closed) {
          try {
            controller.close()
          } catch {
            /* already closed */
          }
        }
      }
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Tells nginx-style proxies not to buffer the stream.
      'X-Accel-Buffering': 'no',
    },
  })
}
