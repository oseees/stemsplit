import LoginForm from "../LoginForm"

export const metadata = { title: "Log in — NairaBulk" }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; checkEmail?: string }>
}) {
  const { next, checkEmail } = await searchParams

  return (
    <div className="mx-auto max-w-sm px-4 py-10">
      <h1 className="text-2xl font-bold">Welcome back</h1>
      <p className="mt-1 text-sm text-gray-500">Log in to your NairaBulk account.</p>

      {checkEmail && (
        <p className="mt-4 rounded-md bg-primary-50 px-3 py-2 text-sm text-primary-800">
          Check your email to confirm your account, then log in.
        </p>
      )}

      <div className="mt-6">
        <LoginForm next={next} />
      </div>
    </div>
  )
}
