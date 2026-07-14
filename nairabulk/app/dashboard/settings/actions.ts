"use server"

import { getSessionUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { normalizeNgPhone } from "@/lib/phone"
import { accountSchema } from "@/lib/validation"

export type SettingsResult = { error?: string; field?: string; success?: boolean }

export async function updateAccountAction(raw: unknown): Promise<SettingsResult> {
  const parsed = accountSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const session = await getSessionUser()
  if (!session) return { error: "Your session expired — please log in again" }

  const phone = normalizeNgPhone(parsed.data.phone)!
  const taken = await prisma.user.findFirst({
    where: { phone, id: { not: session.user.id } },
    select: { id: true },
  })
  if (taken) return { error: "That phone number is already registered", field: "phone" }

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      phone,
      shippingStreet: parsed.data.shippingStreet || null,
      shippingCity: parsed.data.shippingCity,
      shippingState: parsed.data.shippingState,
    },
  })

  return { success: true }
}
