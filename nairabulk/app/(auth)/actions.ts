"use server"

import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"
import { normalizeNgPhone } from "@/lib/phone"
import { signupSchema, loginSchema } from "@/lib/validation"

export type ActionResult = { error?: string; field?: string; redirectTo?: string }

export async function signUpAction(raw: unknown): Promise<ActionResult> {
  const parsed = signupSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { fullName, email, password } = parsed.data
  const phone = normalizeNgPhone(parsed.data.phone)!

  // Pre-check phone uniqueness so we don't create an orphaned auth user on conflict.
  if (await prisma.user.findUnique({ where: { phone } })) {
    return { error: "That phone number is already registered", field: "phone" }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, phone, role: "BUYER" } },
  })
  if (error) return { error: error.message }
  if (!data.user) return { error: "Signup failed — please try again" }

  try {
    await prisma.user.create({
      data: { id: data.user.id, email, phone, fullName, role: "BUYER" },
    })
  } catch {
    return { error: "Could not create your profile — please contact support" }
  }

  // With email confirmation ON, no session is returned until the user confirms.
  return data.session
    ? { redirectTo: "/onboarding" }
    : { redirectTo: "/login?checkEmail=1" }
}

export async function signInAction(raw: unknown, next?: string): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error) return { error: "Incorrect email or password" }

  return { redirectTo: next && next.startsWith("/") ? next : "/dashboard" }
}

export async function signOutAction() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/")
}
