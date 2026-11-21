/**
 * ₹99 per GSTR-1 export, charged once per GSTIN + return period. Paying unlocks
 * both the Excel and JSON downloads for that return; corrections and
 * re-downloads for the same GSTIN and month are free.
 *
 * Note: the return is generated in the browser (files never leave the device),
 * so this gate can be bypassed by someone who edits the page's JavaScript.
 * Server-side verification makes sure every recorded payment is genuine.
 */
export const PRICE_RUPEES = 99
const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js'
const STORAGE_KEY = 'gstbridge.paid-exports.v1'

export interface ExportReceipt {
  gstin: string
  period: string
  orderId: string
  paymentId: string
  amount: number
  paidAt: string
  token: string
}

interface RazorpaySuccess {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

interface RazorpayFailure {
  error?: { description?: string; reason?: string }
}

interface RazorpayInstance {
  open: () => void
  on: (event: 'payment.failed', handler: (response: RazorpayFailure) => void) => void
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance
  }
}

export class PaymentCancelledError extends Error {
  constructor() {
    super('Payment was cancelled.')
  }
}

export class PaymentBackendMissingError extends Error {
  constructor() {
    super('The payment server is not running. Use "npx wrangler pages dev" (see README) or deploy to Cloudflare Pages.')
  }
}

function readReceipts(): ExportReceipt[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveReceipt(receipt: ExportReceipt) {
  try {
    const others = readReceipts().filter((item) => !(item.gstin === receipt.gstin && item.period === receipt.period))
    localStorage.setItem(STORAGE_KEY, JSON.stringify([receipt, ...others].slice(0, 200)))
  } catch {
    // Storage can be unavailable (private mode); the unlock then lasts for this page only.
  }
}

export function findReceipt(gstin: string, period: string) {
  return readReceipts().find((item) => item.gstin === gstin.toUpperCase() && item.period === period)
}

let checkoutLoader: Promise<void> | null = null
function loadCheckout() {
  if (window.Razorpay) return Promise.resolve()
  checkoutLoader ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = CHECKOUT_SCRIPT
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      checkoutLoader = null
      reject(new Error('Could not load Razorpay. Check your internet connection and try again.'))
    }
    document.head.appendChild(script)
  })
  return checkoutLoader
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('Could not reach the payment server. Check your internet connection.')
  }
  const isJson = response.headers.get('content-type')?.includes('application/json')
  if (!isJson) throw new PaymentBackendMissingError()
  const data = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(data.error ?? `Payment server error (${response.status}).`)
  return data
}

export async function payForExport(gstin: string, period: string): Promise<ExportReceipt> {
  const target = { gstin: gstin.toUpperCase(), period }
  const [order] = await Promise.all([
    postJson<{ orderId: string; amount: number; currency: string; keyId: string }>('/api/create-order', target),
    loadCheckout(),
  ])
  if (!window.Razorpay) throw new Error('Razorpay checkout did not load.')

  const success = await new Promise<RazorpaySuccess>((resolve, reject) => {
    const checkout = new window.Razorpay!({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      name: 'GSTBridge',
      description: `GSTR-1 export · ${target.gstin} · ${target.period}`,
      notes: target,
      theme: { color: '#17865b' },
      handler: resolve,
      modal: { ondismiss: () => reject(new PaymentCancelledError()), confirm_close: true },
    })
    checkout.on('payment.failed', (response) => {
      reject(new Error(response.error?.description ?? 'Payment failed. No money was taken; please try again.'))
    })
    checkout.open()
  })

  const verified = await postJson<{ ok: boolean; receipt: ExportReceipt }>('/api/verify-payment', {
    ...target,
    orderId: success.razorpay_order_id,
    paymentId: success.razorpay_payment_id,
    signature: success.razorpay_signature,
  })
  if (!verified.ok) throw new Error('Payment could not be verified.')
  saveReceipt(verified.receipt)
  return verified.receipt
}

/** Local development only: unlock without a payment server. Stripped from production builds. */
export function simulatePaymentForDevelopment(gstin: string, period: string): ExportReceipt {
  if (!import.meta.env.DEV) throw new Error('Not available in production.')
  const receipt: ExportReceipt = {
    gstin: gstin.toUpperCase(),
    period,
    orderId: 'order_DEV',
    paymentId: 'pay_DEV',
    amount: PRICE_RUPEES * 100,
    paidAt: new Date().toISOString(),
    token: 'dev',
  }
  saveReceipt(receipt)
  return receipt
}
