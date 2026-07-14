import { z } from "zod"
import { isValidNgPhone } from "./phone"
import { NIGERIAN_STATES } from "./nigeria"

const phone = z
  .string()
  .min(1, "Phone number is required")
  .refine(isValidNgPhone, "Enter a valid Nigerian phone number")

export const signupSchema = z.object({
  fullName: z.string().min(2, "Enter your full name").max(80),
  email: z.string().email("Enter a valid email"),
  phone,
  password: z.string().min(8, "Password must be at least 8 characters"),
})

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
})

export const completeProfileSchema = z.object({
  shippingState: z.enum(NIGERIAN_STATES, { message: "Select your state" }),
  shippingCity: z.string().min(2, "Enter your city or town"),
})

export const accountSchema = z.object({
  phone,
  shippingStreet: z.string().max(120).optional().or(z.literal("")),
  shippingCity: z.string().min(2, "Enter your city or town"),
  shippingState: z.enum(NIGERIAN_STATES, { message: "Select your state" }),
})

export type SignupInput = z.infer<typeof signupSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type CompleteProfileInput = z.infer<typeof completeProfileSchema>
export type AccountInput = z.infer<typeof accountSchema>
