import Link from "next/link";

const nav = [
  { href: "/campaigns", label: "Browse Campaigns" },
  { href: "/#how-it-works", label: "How It Works" },
  { href: "/orders", label: "My Orders" },
];

export default function Header() {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-4">
        <Link href="/" className="text-xl font-bold text-primary-700">
          Naira<span className="text-gray-900">Bulk</span>
        </Link>
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-medium text-gray-600">
          {nav.map(({ href, label }) => (
            <Link key={href} href={href} className="hover:text-primary-700">
              {label}
            </Link>
          ))}
        </nav>
        <Link
          href="/login"
          className="ml-auto rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
        >
          Login
        </Link>
      </div>
    </header>
  );
}
