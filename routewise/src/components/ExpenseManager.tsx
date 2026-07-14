"use client"

import { useState } from "react"
import { useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import {
  expenseSchema,
  CATEGORIES,
  type ExpenseForm,
  type ExpenseOutput,
} from "@/lib/validations"
import { money, fmtDate, toDateInput } from "@/lib/utils"
import { CATEGORY_COLORS } from "@/lib/utils"

type Expense = {
  id: string
  amount: number
  category: string
  date: string
  notes: string | null
}

export default function ExpenseManager({
  tripId,
  currency,
  expenses,
}: {
  tripId: string
  currency: string
  expenses: Expense[]
}) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState("")

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ExpenseForm, unknown, ExpenseOutput>({
    resolver: zodResolver(expenseSchema) as Resolver<ExpenseForm, unknown, ExpenseOutput>,
    defaultValues: { category: "Food", date: toDateInput(new Date()) },
  })

  function startEdit(e: Expense) {
    setEditingId(e.id)
    reset({
      amount: e.amount,
      category: e.category as ExpenseForm["category"],
      date: toDateInput(e.date),
      notes: e.notes ?? "",
    })
  }

  function cancelEdit() {
    setEditingId(null)
    reset({ category: "Food", date: toDateInput(new Date()), amount: undefined, notes: "" })
  }

  async function onSubmit(values: ExpenseOutput) {
    setError("")
    const res = await fetch(editingId ? `/api/expenses/${editingId}` : "/api/expenses", {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editingId ? values : { ...values, tripId }),
    })
    if (!res.ok) {
      setError("Could not save expense.")
      return
    }
    cancelEdit()
    router.refresh()
  }

  async function remove(id: string) {
    if (!confirm("Delete this expense?")) return
    await fetch(`/api/expenses/${id}`, { method: "DELETE" })
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit(onSubmit)} className="card grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className="label">Amount</label>
          <input type="number" step="0.01" min={0} className="field" {...register("amount")} />
          {errors.amount && <p className="err">{errors.amount.message}</p>}
        </div>
        <div>
          <label className="label">Category</label>
          <select className="field" {...register("category")}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Date</label>
          <input type="date" className="field" {...register("date")} />
          {errors.date && <p className="err">{errors.date.message}</p>}
        </div>
        <div>
          <label className="label">Notes</label>
          <input className="field" placeholder="optional" {...register("notes")} />
        </div>
        {error && <p className="err col-span-full">{error}</p>}
        <div className="col-span-full flex justify-end gap-2">
          {editingId && (
            <button type="button" className="btn-ghost" onClick={cancelEdit}>
              Cancel
            </button>
          )}
          <button type="submit" className="btn-primary" disabled={isSubmitting}>
            {editingId ? "Update expense" : "Add expense"}
          </button>
        </div>
      </form>

      <div className="card p-0">
        {expenses.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-400">No expenses logged yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {expenses.map((e) => (
              <li key={e.id} className="flex items-center gap-3 p-4">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: CATEGORY_COLORS[e.category] ?? "#64748b" }}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-800">{e.category}</p>
                  <p className="truncate text-xs text-slate-500">
                    {fmtDate(e.date)}
                    {e.notes ? ` · ${e.notes}` : ""}
                  </p>
                </div>
                <span className="font-semibold">{money(e.amount, currency)}</span>
                <button className="text-xs text-slate-500 hover:text-brand-700" onClick={() => startEdit(e)}>
                  Edit
                </button>
                <button className="text-xs text-red-500 hover:text-red-700" onClick={() => remove(e.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
