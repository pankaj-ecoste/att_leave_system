// plan.md §47 — helpers for saving a site visit on a weak mobile connection.

// Browser network failures show up as one of these messages (iOS Safari: "Load failed").
// Server-side rejections (e.g. "Punch in before logging a site visit") are NOT network errors
// and must never be retried.
export function isNetworkError(e) {
  const msg = String(e?.message || e || '').toLowerCase()
  return msg.includes('load failed') || msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('network')
}

// Retries only network failures, with a short growing pause. Server rejections throw at once.
export async function withRetry(fn, { attempts = 3, baseDelayMs = 800, onRetry } = {}) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (!isNetworkError(e) || i === attempts) throw e
      onRetry?.(i)
      await new Promise(r => setTimeout(r, baseDelayMs * i))
    }
  }
  throw lastErr
}

export function friendlySaveError(e) {
  if (isNetworkError(e)) return "Couldn't reach the server — check your signal and tap Save Visit again. Your photos and details are still here."
  return e?.message || 'Could not save the visit'
}

// Phone photos are 2-9 MB straight from the camera. A ~1600 px JPEG is a few hundred KB and
// uploads far more reliably on mobile data. If the browser can't decode the image, the
// original file is used unchanged, so this can never block a save.
export async function shrinkImage(file, { maxSide = 1600, quality = 0.8 } = {}) {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file
  }
}
