import SignupForm from "../SignupForm"

export const metadata = { title: "Sign up — NairaBulk" }

export default function SignupPage() {
  return (
    <div className="mx-auto max-w-sm px-4 py-10">
      <h1 className="text-2xl font-bold">Create your account</h1>
      <p className="mt-1 text-sm text-gray-500">
        Join a group buy and pay bulk prices on tech.
      </p>
      <div className="mt-6">
        <SignupForm />
      </div>
    </div>
  )
}
