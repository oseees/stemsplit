"use server"

import { getSessionUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { completeProfileSchema } from "@/lib/validation"
import type { ActionResult } from "../(auth)/actions"

export async function completeProfileAction(raw: unknown): Promise<ActionResult> {
  const parsed = completeProfileSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const session = await getSessionUser()
  if (!session) return { error: "Your session expired — please log in again" }

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      shippingState: parsed.data.shippingState,
      shippingCity: parsed.data.shippingCity,
    },
  })

  return { redirectTo: "/dashboard" }
}
