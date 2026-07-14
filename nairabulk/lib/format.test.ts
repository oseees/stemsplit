// Run: npx tsx lib/format.test.ts
import assert from 'node:assert'
import { timeLeft, spotsLabel, naira } from './format'

const now = new Date('2026-07-06T00:00:00Z')
const h = (n: number) => new Date(now.getTime() + n * 3_600_000)

assert.equal(timeLeft(h(-1), now), 'Ended')
assert.equal(timeLeft(h(0), now), 'Ended')
assert.equal(timeLeft(h(0.5), now), '30 mins left')
assert.equal(timeLeft(h(1), now), '1 hour left')
assert.equal(timeLeft(h(5), now), '5 hours left')
assert.equal(timeLeft(h(24), now), '1 day left')
assert.equal(timeLeft(h(72), now), '3 days left')

assert.equal(spotsLabel({ unitsCommitted: 4, moq: 10, maxUnits: 100 }), '6 more to unlock')
assert.equal(spotsLabel({ unitsCommitted: 14, moq: 10, maxUnits: 100 }), '86 spots left')
assert.equal(spotsLabel({ unitsCommitted: 100, moq: 10, maxUnits: 100 }), 'Fully booked')
assert.equal(spotsLabel({ unitsCommitted: 20, moq: 10, maxUnits: null }), 'Deal unlocked')

assert.match(naira(285000), /285,000/)

console.log('format ok')
