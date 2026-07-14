// Run: npx tsx lib/fx.test.ts
import assert from "node:assert"
import { fetchRates } from "./fx"

process.env.EXCHANGERATE_API_KEY = "testkey"

async function main() {
  // Fake exchangerate-api response: 1 USD = 1650 NGN, 1 USD = 7.2 CNY.
  const fakeFetch = (async () =>
    new Response(
      JSON.stringify({ result: "success", conversion_rates: { NGN: 1650, CNY: 7.2 } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )) as unknown as typeof fetch

  const rates = await fetchRates(fakeFetch)
  assert.equal(rates.usdToNgn, 1650)
  // RMB→NGN = 1650 / 7.2 = 229.17
  assert.ok(Math.abs(rates.rmbToNgn - 229.1667) < 0.01, `got ${rates.rmbToNgn}`)

  // Malformed response is rejected.
  const badFetch = (async () =>
    new Response(JSON.stringify({ result: "error" }), { status: 200 })) as unknown as typeof fetch
  await assert.rejects(() => fetchRates(badFetch))

  console.log("fx ok")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
