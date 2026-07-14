import { forwardRef } from "react"

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string
  error?: string
}

// Mobile-first labeled input. text-base keeps iOS from zooming on focus.
export const TextField = forwardRef<HTMLInputElement, Props>(function TextField(
  { label, error, ...rest },
  ref
) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <input
        ref={ref}
        {...rest}
        className={`mt-1 w-full rounded-md border px-3 py-3 text-base outline-none focus:ring-2 focus:ring-primary-500 ${
          error ? "border-red-400" : "border-gray-300"
        }`}
        aria-invalid={error ? "true" : undefined}
      />
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  )
})
