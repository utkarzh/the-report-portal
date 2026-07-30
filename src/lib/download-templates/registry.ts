// ────────────────────────────────────────────────────────────────────────────
// Download-template registry — METADATA ONLY.
//
// A "template" is a branded header/footer treatment the user picks before
// downloading research / interview questions / a transcript. There are two
// brand families — TRC (The Report Company) and GFDI (Global FDI Reports) —
// each paired with a partner publication.
//
// ⚠️  THIS MODULE IS IMPORTED BY A CLIENT COMPONENT (ui/DownloadTemplateModal)
// and so MUST NOT import ./assets or ./fonts. Those hold ~700 KB of base64 band
// artwork and ~750 KB of base64 font respectively; pulling either in ships it to
// the browser. An earlier version of this file referenced ./assets directly for
// the one image template it had, and when the other seven gained real artwork
// that quietly added ~420 KB to the First Load JS of every page with a download
// button. Templates therefore carry a `bandKey` — a lookup string — instead of
// the band bytes, and only the server-side builders (docx.ts, pdf.tsx, through
// bands.ts) resolve it to actual image data.
//
// All eight templates are `kind: 'image'`: their header and footer are the real
// full-width bands from the client's own artwork (see assets.ts for provenance),
// so every download is pixel-faithful — real logos, real fonts, real rules.
//
// `kind: 'composed'` is the fallback for a future partner the client has NOT
// sent artwork for: docx.ts / pdf.tsx rebuild the same layout from the TRC
// wordmark plus the partner name as styled text. No current template uses it.
// Prefer getting artwork over adding a composed entry — a composed band carries
// the partner's name but not its logo.
// ────────────────────────────────────────────────────────────────────────────

export type BrandFamily = 'TRC' | 'GFDI'

export interface BandImage {
  base64: string
  width: number
  height: number
}

// The asset-name stem a template's bands are stored under in assets.ts. Going
// through a closed union means a typo, or a template whose bands were never
// generated, is a COMPILE error in bands.ts rather than a blank header at
// download time.
export type BandKey =
  | 'TRC_USA_TODAY'
  | 'TRC_ECONOMIC_OBSERVER'
  | 'TRC_NEWSWEEK'
  | 'TRC_GUARDIAN'
  | 'TRC_FOREIGN_POLICY'
  | 'GFDI_DIE_WELT'
  | 'GFDI_GULF_NEWS'
  | 'GFDI_USA_TODAY'

export interface DownloadTemplate {
  id: string
  label: string
  brand: BrandFamily
  partner: string
  /** 'image' = real client artwork, resolved via bandKey; 'composed' = rebuilt from logo + text. */
  kind: 'image' | 'composed'
  /** Partner site line shown in the footer (composed templates only). */
  partnerSite: string
  /** Which bands in assets.ts to use. Required when kind === 'image'. */
  bandKey?: BandKey
}

// Brand wordmark address block, used by composed footers and nothing else while
// all eight templates are image-based. Both blocks are transcribed from the
// client's real footers.
export const BRAND_INFO: Record<BrandFamily, { name: string; address: string[]; site: string }> = {
  TRC: {
    name: 'The Report Company',
    address: [
      'Calle Cervantes 34, 28014, Madrid, Spain',
      'Unit A, 25/F., One Island South, 2 Heung Yip Road, Wong Chuk Hang, HK',
    ],
    site: 'www.the-report.com',
  },
  GFDI: {
    name: 'Global FDI Reports',
    address: ['C/ Castelló 59, 28001, Madrid, Madrid, Spain'],
    site: 'globalfdireports.com',
  },
}

export const TEMPLATES: DownloadTemplate[] = [
  {
    id: 'trc-usa-today',
    label: 'TRC – USA Today',
    brand: 'TRC',
    partner: 'USA Today',
    kind: 'image',
    partnerSite: 'usatoday.com',
    bandKey: 'TRC_USA_TODAY',
  },
  {
    id: 'trc-economic-observer',
    label: 'TRC – The Economic Observer',
    brand: 'TRC',
    partner: 'The Economic Observer',
    kind: 'image',
    partnerSite: 'eeo.com.cn',
    bandKey: 'TRC_ECONOMIC_OBSERVER',
  },
  {
    id: 'trc-newsweek',
    label: 'TRC – Newsweek',
    brand: 'TRC',
    partner: 'Newsweek',
    kind: 'image',
    partnerSite: 'newsweek.com',
    bandKey: 'TRC_NEWSWEEK',
  },
  {
    id: 'trc-guardian',
    label: 'TRC – The Guardian',
    brand: 'TRC',
    partner: 'The Guardian',
    kind: 'image',
    partnerSite: 'www.theguardian.com',
    bandKey: 'TRC_GUARDIAN',
  },
  {
    id: 'trc-foreign-policy',
    label: 'TRC – Foreign Policy',
    brand: 'TRC',
    partner: 'Foreign Policy',
    kind: 'image',
    partnerSite: 'foreignpolicy.com',
    bandKey: 'TRC_FOREIGN_POLICY',
  },
  {
    id: 'gfdi-die-welt',
    label: 'GFDI – Die Welt',
    brand: 'GFDI',
    partner: 'Die Welt',
    kind: 'image',
    partnerSite: 'welt.de',
    bandKey: 'GFDI_DIE_WELT',
  },
  {
    id: 'gfdi-gulf-news',
    label: 'GFDI – Gulf News',
    brand: 'GFDI',
    partner: 'Gulf News',
    kind: 'image',
    partnerSite: 'www.gulfnews.com',
    bandKey: 'GFDI_GULF_NEWS',
  },
  {
    id: 'gfdi-usa-today',
    label: 'GFDI – USA Today',
    brand: 'GFDI',
    partner: 'USA Today',
    kind: 'image',
    partnerSite: 'usatoday.com',
    bandKey: 'GFDI_USA_TODAY',
  },
]

export const DEFAULT_TEMPLATE_ID = 'trc-usa-today'

export function getTemplate(id: string | null | undefined): DownloadTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]
}
