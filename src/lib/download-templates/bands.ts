// ────────────────────────────────────────────────────────────────────────────
// Band resolution — SERVER ONLY.
//
// Turns a template's `bandKey` into the actual header/footer image bytes. This is
// the ONLY module that reads ./assets, which is ~700 KB of base64 artwork.
//
// Keep it that way. registry.ts is imported by a client component, so if the
// band data were reachable from there the whole 700 KB would land in the browser
// bundle (it did once — see the warning at the top of registry.ts). Import this
// module only from the download builders (docx.ts, pdf.tsx) or an API route.
// ────────────────────────────────────────────────────────────────────────────

import * as ASSETS from './assets'
import type { BandImage, BandKey, DownloadTemplate } from './registry'

export interface TemplateBands {
  header: BandImage
  footer: BandImage
}

// The template-literal index is what makes the BandKey union load-bearing: if a
// key has no matching *_HEADER_JPEG_BASE64 / *_W / *_H trio in assets.ts, this
// fails to compile instead of producing `undefined` at download time.
function band(key: BandKey, which: 'HEADER' | 'FOOTER'): BandImage {
  return {
    base64: ASSETS[`${key}_${which}_JPEG_BASE64`],
    width: ASSETS[`${key}_${which}_W`],
    height: ASSETS[`${key}_${which}_H`],
  }
}

/** Bands for an image template, or null for a composed one (build it from text). */
export function templateBands(template: DownloadTemplate): TemplateBands | null {
  if (template.kind !== 'image' || !template.bandKey) return null
  return {
    header: band(template.bandKey, 'HEADER'),
    footer: band(template.bandKey, 'FOOTER'),
  }
}
