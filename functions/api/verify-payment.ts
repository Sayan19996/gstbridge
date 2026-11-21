import {
  configured, isValidCheckoutSignature, json, parseExportTarget, priceFor, razorpay, unlockToken,
} from '../../server/razorpay.ts'
import type { FunctionContext } from '../../server/razorpay.ts'

interface RazorpayOrder {
  id: string
  amount: number
  notes?: Record<string, string> | []
}

interface RazorpayPayment {
  id: string
  order_id: string
  amount: number
  currency: string
  status: string
  created_at: number
}

/**
 * POST /api/verify-payment
 * { orderId, paymentId, signature, gstin, period } → { ok, receipt }
 * Checks the Checkout signature, then confirms with Razorpay that the payment is
 * real, paid in full, and belongs to an order created for this GSTIN and period.
 */
export async function onRequestPost({ request, env }: FunctionContext) {
  if (!configured(env)) return json({ error: 'Payments are not configured on this deployment.' }, 503)

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const target = parseExportTarget(body)
  if ('error' in target) return json({ error: target.error }, 400)
  const orderId = String(body?.orderId ?? '')
  const paymentId = String(body?.paymentId ?? '')
  const signature = String(body?.signature ?? '')
  if (!/^order_\w+$/.test(orderId) || !/^pay_\w+$/.test(paymentId) || !/^[0-9a-f]{64}$/i.test(signature)) {
    return json({ error: 'Incomplete payment details.' }, 400)
  }

  if (!await isValidCheckoutSignature(env.RAZORPAY_KEY_SECRET, orderId, paymentId, signature)) {
    return json({ error: 'Payment signature did not match.' }, 400)
  }

  try {
    const [order, payment] = await Promise.all([
      razorpay<RazorpayOrder>(env, `/orders/${orderId}`),
      razorpay<RazorpayPayment>(env, `/payments/${paymentId}`),
    ])
    const notes = Array.isArray(order.notes) ? {} : order.notes ?? {}
    const price = priceFor(env)
    if (payment.order_id !== orderId) return json({ error: 'Payment does not belong to this order.' }, 400)
    if (order.amount < price || payment.amount < price || payment.currency !== 'INR') {
      return json({ error: 'Payment amount is incorrect.' }, 400)
    }
    if (!['captured', 'authorized'].includes(payment.status)) {
      return json({ error: `Payment is ${payment.status}, not completed.` }, 402)
    }
    if (notes.gstin !== target.gstin || notes.period !== target.period) {
      return json({ error: 'This payment was made for a different GSTIN or return period.' }, 400)
    }

    return json({
      ok: true,
      receipt: {
        gstin: target.gstin,
        period: target.period,
        orderId,
        paymentId,
        amount: payment.amount,
        paidAt: new Date(payment.created_at * 1000).toISOString(),
        token: await unlockToken(env.RAZORPAY_KEY_SECRET, target.gstin, target.period, paymentId),
      },
    })
  } catch (cause) {
    return json({ error: cause instanceof Error ? cause.message : 'Could not verify the payment.' }, 502)
  }
}
