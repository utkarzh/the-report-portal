// ────────────────────────────────────────────────────────────────────────────
// Download-template registry.
//
// A "template" is a branded header/footer treatment the user picks before
// downloading research / interview questions / a transcript. There are two
// brand families — TRC (The Report Company) and GFDI — each paired with a
// partner publication.
//
// Only `trc-usa-today` is `kind: 'image'`: its header/footer are the real
// full-width bands extracted from the client's sample PDF (assets.ts), so it is
// pixel-faithful. The other seven are `kind: 'composed'` STUBS — the same layout
// rebuilt from the TRC/GFDI wordmark + the partner name as styled text — until
// the client sends each publication's own sample. To promote a stub to a real
// template later: add its bands to assets.ts and switch `kind`/`header`/`footer`
// here. Nothing else changes.
// ────────────────────────────────────────────────────────────────────────────

import {
  TRC_USA_TODAY_HEADER_JPEG_BASE64,
  TRC_USA_TODAY_HEADER_W,
  TRC_USA_TODAY_HEADER_H,
  TRC_USA_TODAY_FOOTER_JPEG_BASE64,
  TRC_USA_TODAY_FOOTER_W,
  TRC_USA_TODAY_FOOTER_H,
} from './assets'

export type BrandFamily = 'TRC' | 'GFDI'

export interface BandImage {
  base64: string
  width: number
  height: number
}

export interface DownloadTemplate {
  id: string
  label: string
  brand: BrandFamily
  partner: string
  /** 'image' = real extracted bands; 'composed' = stub built from logo + text. */
  kind: 'image' | 'composed'
  /** Partner site line shown in the footer (composed templates). */
  partnerSite: string
  /** Real bands — present only when kind === 'image'. */
  header?: BandImage
  footer?: BandImage
}

// Brand wordmark address block used in composed footers.
export const BRAND_INFO: Record<BrandFamily, { name: string; address: string[]; site: string }> = {
  TRC: {
    name: 'The Report Company',
    address: [
      'Calle Cervantes 34, 28014, Madrid, Spain',
      'Unit A, 25/F, One Island South, 2 Heung Yip Road, Wong Chuk Hang, HK',
    ],
    site: 'www.the-report.com',
  },
  // TODO(client): confirm GFDI legal name + address once a GFDI sample arrives.
  GFDI: {
    name: 'GFDI Reports',
    address: ['GFDI Reports'],
    site: 'www.gfdi-reports.com',
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
    header: {
      base64: TRC_USA_TODAY_HEADER_JPEG_BASE64,
      width: TRC_USA_TODAY_HEADER_W,
      height: TRC_USA_TODAY_HEADER_H,
    },
    footer: {
      base64: TRC_USA_TODAY_FOOTER_JPEG_BASE64,
      width: TRC_USA_TODAY_FOOTER_W,
      height: TRC_USA_TODAY_FOOTER_H,
    },
  },
  {
    id: 'trc-economic-observer',
    label: 'TRC – The Economic Observer',
    brand: 'TRC',
    partner: 'The Economic Observer',
    kind: 'composed',
    partnerSite: 'eeo.com.cn',
  },
  {
    id: 'trc-newsweek',
    label: 'TRC – Newsweek',
    brand: 'TRC',
    partner: 'Newsweek',
    kind: 'composed',
    partnerSite: 'newsweek.com',
  },
  {
    id: 'trc-guardian',
    label: 'TRC – The Guardian',
    brand: 'TRC',
    partner: 'The Guardian',
    kind: 'composed',
    partnerSite: 'theguardian.com',
  },
  {
    id: 'trc-foreign-policy',
    label: 'TRC – Foreign Policy',
    brand: 'TRC',
    partner: 'Foreign Policy',
    kind: 'composed',
    partnerSite: 'foreignpolicy.com',
  },
  {
    id: 'gfdi-die-welt',
    label: 'GFDI – Die Welt',
    brand: 'GFDI',
    partner: 'Die Welt',
    kind: 'composed',
    partnerSite: 'welt.de',
  },
  {
    id: 'gfdi-gulf-news',
    label: 'GFDI – Gulf News',
    brand: 'GFDI',
    partner: 'Gulf News',
    kind: 'composed',
    partnerSite: 'gulfnews.com',
  },
  {
    id: 'gfdi-usa-today',
    label: 'GFDI – USA Today',
    brand: 'GFDI',
    partner: 'USA Today',
    kind: 'composed',
    partnerSite: 'usatoday.com',
  },
]

export const DEFAULT_TEMPLATE_ID = 'trc-usa-today'

export function getTemplate(id: string | null | undefined): DownloadTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]
}
