// Reads a `data: <json>\n\n` Server-Sent Events response (the format every
// streaming route in this app uses) and calls `onEvent` for each JSON
// payload. Heartbeats (`{ping:true}`) and the `[DONE]` sentinel are skipped.
// Resolves when the server closes the stream.
export async function readSseStream(
  res: Response,
  onEvent: (payload: Record<string, unknown>) => void,
): Promise<void> {
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() || ''
    for (const frame of frames) {
      const line = frame.startsWith('data: ') ? frame.slice(6) : frame.trim()
      if (!line || line === '[DONE]') continue
      let payload: Record<string, unknown>
      try {
        payload = JSON.parse(line)
      } catch {
        continue
      }
      if (payload && payload.ping === true) continue
      onEvent(payload)
    }
  }
}

// POSTs and reads the stream, resolving with the final `{done:true}` payload
// or throwing the server's `{error}` / a non-2xx JSON error.
export async function postSse<T extends Record<string, unknown>>(
  url: string,
  body: unknown,
  onEvent?: (payload: Record<string, unknown>) => void,
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`)
  }
  let final: T | null = null
  let error: string | null = null
  await readSseStream(res, (payload) => {
    if (typeof payload.error === 'string') error = payload.error
    if (payload.done === true) final = payload as T
    onEvent?.(payload)
  })
  if (error) throw new Error(error)
  if (!final) throw new Error('The connection closed before the result arrived. Refresh to see whether it finished.')
  return final
}
