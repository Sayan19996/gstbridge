/**
 * Cloudflare Workers entry point (used when the project is deployed as a Worker,
 * e.g. gstbridge.<you>.workers.dev). Serves the built site from ./dist and runs
 * the two payment endpoints. The same handlers also run as Pages Functions from
 * /functions when the project is deployed to Cloudflare Pages instead.
 */
import { onRequestPost as createOrder } from '../functions/api/create-order.ts'
import { onRequestPost as verifyPayment } from '../functions/api/verify-payment.ts'
import { json } from '../server/razorpay.ts'
import type { Env as PaymentEnv } from '../server/razorpay.ts'

interface Env extends PaymentEnv {
  ASSETS: { fetch: (request: Request) => Promise<Response> }
}

const routes: Record<string, (context: { request: Request; env: PaymentEnv }) => Promise<Response>> = {
  '/api/create-order': createOrder,
  '/api/verify-payment': verifyPayment,
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname.startsWith('/api/')) {
      const handler = routes[pathname]
      if (!handler) return json({ error: 'Not found.' }, 404)
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
      return handler({ request, env })
    }
    return env.ASSETS.fetch(request)
  },
}
