/**
 * Server-side helpers for the ₹99-per-return payment, shared by the Cloudflare
 * Pages Functions in /functions/api. Secrets never reach the browser.
 *
 * Required environment variables (Cloudflare Pages → Settings → Variables and Secrets):
 *   RAZORPAY_KEY_ID      rzp_live_… (or rzp_test_… while testing)
 *   RAZORPAY_KEY_SECRET  the matching key secret (add it as an encrypted Secret)
 * Optional:
 *   PRICE_PAISE          defaults to 9900 (₹99)
 */
export interface Env {
  RAZORPAY_KEY_ID?: string
  RAZORPAY_KEY_SECRET?: string
  PRICE_PAISE?: string
}

export interface FunctionContext {
  request: Request
  env: Env
}

export const DEFAULT_PRICE_PAISE = 9900
const RAZORPAY_API = 'https://api.razorpay.com/v1'
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

export function priceFor(env: Env) {
  const configured = Number(env.PRICE_PAISE)
  return Number.isInteger(configured) && configured >= 100 ? configured : DEFAULT_PRICE_PAISE
}

export function configured(env: Env): env is Required<Pick<Env, 'RAZORPAY_KEY_ID' | 'RAZORPAY_KEY_SECRET'>> & Env {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET)
}

export function parseExportTarget(body: unknown) {
  const value = (body ?? {}) as Record<string, unknown>
  const gstin = String(value.gstin ?? '').trim().toUpperCase()
  const period = String(value.period ?? '').trim()
  if (!GSTIN.test(gstin)) return { error: 'Invalid GSTIN.' } as const
  if (!PERIOD.test(period)) return { error: 'Invalid return period.' } as const
  return { gstin, period } as const
}

export async function razorpay<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`)
  const response = await fetch(`${RAZORPAY_API}${path}`, {
    ...init,
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
  const data = await response.json().catch(() => ({})) as T & { error?: { description?: string } }
  if (!response.ok) {
    throw new Error(data.error?.description ?? `Razorpay request failed (${response.status}).`)
  }
  return data
}

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

/** Razorpay Checkout signature: HMAC-SHA256(order_id + "|" + payment_id, key_secret). */
export async function isValidCheckoutSignature(secret: string, orderId: string, paymentId: string, signature: string) {
  const expected = await hmacHex(secret, `${orderId}|${paymentId}`)
  return constantTimeEqual(expected, signature.trim().toLowerCase())
}

/** Receipt token the browser keeps; lets support (or a future server check) confirm an unlock. */
export async function unlockToken(secret: string, gstin: string, period: string, paymentId: string) {
  return hmacHex(secret, `gstbridge-unlock|${gstin}|${period}|${paymentId}`)
}
