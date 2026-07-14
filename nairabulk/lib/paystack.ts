import "server-only"

const BASE = "https://api.paystack.co"

function secret(): string {
  const key = process.env.PAYSTACK_SECRET_KEY
  if (!key || key === "sk_test_YOUR_SECRET") {
    throw new Error("PAYSTACK_SECRET_KEY is not configured")
  }
  return key
}

async function paystack<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secret()}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  })
  const body = (await res.json()) as { status: boolean; message: string; data: T }
  if (!res.ok || !body.status) {
    throw new Error(`Paystack ${path} failed: ${body.message || res.status}`)
  }
  return body.data
}

// Server-side initialize so the charged amount is authoritative (the client can't
// tamper with it) — the browser only resumes the transaction with the access code.
export async function initializeTransaction(args: {
  email: string
  amountKobo: number
  reference: string
}): Promise<{ accessCode: string; reference: string }> {
  const data = await paystack<{ access_code: string; reference: string }>(
    "/transaction/initialize",
    {
      method: "POST",
      body: JSON.stringify({
        email: args.email,
        amount: args.amountKobo,
        reference: args.reference,
        currency: "NGN",
      }),
    }
  )
  return { accessCode: data.access_code, reference: data.reference }
}

export type VerifiedTransaction = {
  status: string // "success", "failed", "abandoned", ...
  amount: number // kobo
  currency: string
  reference: string
}

export function verifyTransaction(reference: string): Promise<VerifiedTransaction> {
  return paystack<VerifiedTransaction>(`/transaction/verify/${encodeURIComponent(reference)}`)
}

// Paystack refunds are async; a truthy response means the refund was accepted.
export async function refundTransaction(reference: string, amountKobo?: number): Promise<void> {
  await paystack("/refund", {
    method: "POST",
    body: JSON.stringify(
      amountKobo != null ? { transaction: reference, amount: amountKobo } : { transaction: reference }
    ),
  })
}
