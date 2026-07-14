import { money } from "../utils"

export interface BudgetEstimate {
  currency: string
  budget: number
  flight: number
  hotel: number
  expenses: number
  committed: number // flight + hotel + expenses
  remaining: number // budget - committed
  usedPct: number
}

export function estimate(input: {
  budget: number
  currency: string
  flight?: number
  hotel?: number
  expenses?: number
}): BudgetEstimate {
  const flight = input.flight ?? 0
  const hotel = input.hotel ?? 0
  const expenses = input.expenses ?? 0
  const committed = flight + hotel + expenses
  const remaining = input.budget - committed
  const usedPct = input.budget > 0 ? Math.min(100, (committed / input.budget) * 100) : 0
  return { currency: input.currency, budget: input.budget, flight, hotel, expenses, committed, remaining, usedPct }
}

export interface BudgetWarning {
  amount: number
  message: string
  suggestions: string[]
}

// `remaining` here is what's left BEFORE adding the option under consideration,
// minus that option's cost. Negative → the option pushes the trip over budget.
export function budgetWarning(
  remaining: number,
  currency: string,
  kind: "flight" | "hotel"
): BudgetWarning | null {
  if (remaining >= 0) return null
  const amount = Math.round(Math.abs(remaining))
  const suggestions =
    kind === "flight"
      ? ["Try different travel dates", "Choose another nearby airport", "Pick a cheaper cabin or airline"]
      : ["Try different dates", "Choose a hotel further from the centre", "Select a lower star rating"]
  return {
    amount,
    message: `This option exceeds your remaining budget by ${money(amount, currency)}.`,
    suggestions,
  }
}
