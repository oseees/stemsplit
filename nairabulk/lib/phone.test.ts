// Run: npx tsx lib/phone.test.ts
import assert from "node:assert"
import { normalizeNgPhone, isValidNgPhone } from "./phone"

// All four accepted input shapes normalize to the same E.164 value.
assert.equal(normalizeNgPhone("08012345678"), "+2348012345678")
assert.equal(normalizeNgPhone("8012345678"), "+2348012345678")
assert.equal(normalizeNgPhone("+2348012345678"), "+2348012345678")
assert.equal(normalizeNgPhone("234 801 234 5678"), "+2348012345678")
assert.equal(normalizeNgPhone("0801-234-5678"), "+2348012345678")

// Rejects bad input.
assert.equal(normalizeNgPhone("0601234567"), null) // 6 not a valid 1st digit
assert.equal(normalizeNgPhone("0812345"), null) // too short
assert.equal(normalizeNgPhone("+2348012345678999"), null) // too long
assert.equal(normalizeNgPhone("notaphone"), null)

assert.equal(isValidNgPhone("0803 456 7890"), true)
assert.equal(isValidNgPhone("12345"), false)

console.log("phone ok")
