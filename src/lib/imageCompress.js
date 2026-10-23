// A camera photo from a modern phone is routinely 2-6 MB at full resolution — far more
// than a verification selfie, a receipt, or a prescription scan actually needs to be
// readable. This resizes and re-encodes the photo in the browser before it's ever
// uploaded, so both the stored file and the upload itself are smaller.
//
// Never the reason an upload fails: if anything here throws (an older browser missing
// these APIs, a corrupted image, etc.) or the "compressed" result isn't actually
// smaller than what came in, the original file is returned untouched. Same posture as
// reverse_geocode() — a convenience, never a blocker. PDFs and anything that isn't an
// image pass through unchanged; this only ever touches image/* files.
//
// imageOrientation: 'from-image' matters specifically for phone photos — a portrait
// photo taken on an iPhone carries its real orientation as EXIF metadata, not in the
// pixels themselves. Without this, a resized photo could come out sideways.
export async function compressImage(file, { maxDim = 1280, quality = 0.8 } = {}) {
  if (!file || !file.type || !file.type.startsWith('image/')) return file

  let bitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob || blob.size >= file.size) return file

    const name = file.name.replace(/\.[^./\\]+$/, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg' })
  } catch (err) {
    console.error('compressImage: falling back to the original file —', err)
    return file
  } finally {
    bitmap?.close?.()
  }
}
