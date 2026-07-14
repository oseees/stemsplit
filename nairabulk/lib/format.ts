export const naira = (amount: number) =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(amount)

// Human "time left until deadline". `now` is injectable for testing.
export function timeLeft(deadline: Date, now: Date = new Date()): string {
  const ms = deadline.getTime() - now.getTime()
  if (ms <= 0) return 'Ended'
  const days = Math.floor(ms / 86_400_000)
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'} left`
  const hours = Math.floor(ms / 3_600_000)
  if (hours >= 1) return `${hours} hour${hours === 1 ? '' : 's'} left`
  const mins = Math.max(1, Math.floor(ms / 60_000))
  return `${mins} min${mins === 1 ? '' : 's'} left`
}

// Urgency line for the group-buy mechanic: unlock progress, then cap scarcity.
export function spotsLabel(args: {
  unitsCommitted: number
  moq: number
  maxUnits: number | null
}): string {
  const { unitsCommitted, moq, maxUnits } = args
  if (unitsCommitted < moq) return `${moq - unitsCommitted} more to unlock`
  if (maxUnits != null) {
    const left = maxUnits - unitsCommitted
    return left <= 0 ? 'Fully booked' : `${left} spot${left === 1 ? '' : 's'} left`
  }
  return 'Deal unlocked'
}
