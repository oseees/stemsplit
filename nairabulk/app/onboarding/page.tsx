import ProfileForm from "./ProfileForm"

export const metadata = { title: "Complete your profile — NairaBulk" }

export default function OnboardingPage() {
  return (
    <div className="mx-auto max-w-sm px-4 py-10">
      <h1 className="text-2xl font-bold">Where do we deliver?</h1>
      <p className="mt-1 text-sm text-gray-500">
        We use this to estimate shipping costs on your orders.
      </p>
      <div className="mt-6">
        <ProfileForm />
      </div>
    </div>
  )
}
