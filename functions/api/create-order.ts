import { configured, json, parseExportTarget, priceFor, razorpay } from '../../server/razorpay.ts'
import type { FunctionContext } from '../../server/razorpay.ts'

interface RazorpayOrder {
  id: string
  amount: number
  currency: string
}

/** POST /api/create-order  { gstin, period } → Razorpay order for one GSTR-1 export. */
export async function onRequestPost({ request, env }: FunctionContext) {
  if (!configured(env)) return json({ error: 'Payments are not configured on this deployment.' }, 503)

  const target = parseExportTarget(await request.json().catch(() => null))
  if ('error' in target) return json({ error: target.error }, 400)

  const amount = priceFor(env)
  const fp = `${target.period.slice(5, 7)}${target.period.slice(0, 4)}`
  try {
    const order = await razorpay<RazorpayOrder>(env, '/orders', {
      method: 'POST',
      body: JSON.stringify({
        amount,
        currency: 'INR',
        receipt: `gb_${target.gstin}_${fp}_${Date.now().toString(36)}`.slice(0, 40),
        notes: { product: 'GSTR-1 export', gstin: target.gstin, period: target.period },
      }),
    })
    return json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: env.RAZORPAY_KEY_ID })
  } catch (cause) {
    return json({ error: cause instanceof Error ? cause.message : 'Could not create the payment order.' }, 502)
  }
}
