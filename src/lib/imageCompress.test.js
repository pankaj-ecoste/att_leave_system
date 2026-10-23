import { describe, it, expect } from 'vitest'
import { compressImage } from './imageCompress'

// This test suite runs under plain Node (vitest.config.js: environment 'node'), which
// has no canvas/createImageBitmap — the real browser resize/re-encode path can only be
// proven on an actual device. What IS fully verifiable here, and matters most, is the
// safety contract: this function must never be the reason an upload fails, and must
// never touch a file it shouldn't.
describe('compressImage', () => {
  it('leaves non-image files (e.g. a PDF prescription) completely untouched', async () => {
    const pdf = new File([new Uint8Array([1, 2, 3])], 'prescription.pdf', { type: 'application/pdf' })
    const result = await compressImage(pdf)
    expect(result).toBe(pdf)
  })

  it('falls back to the exact original file when the environment has no image-processing APIs', async () => {
    // Node has no createImageBitmap/canvas — this genuinely exercises the catch-and-
    // fall-back branch, the same way an older or unusual mobile browser would.
    const img = new File([new Uint8Array([1, 2, 3])], 'selfie.jpg', { type: 'image/jpeg' })
    const result = await compressImage(img)
    expect(result).toBe(img)
  })

  it('a file with no name/type at all is returned as-is rather than throwing', async () => {
    const result = await compressImage(null)
    expect(result).toBe(null)
  })
})
