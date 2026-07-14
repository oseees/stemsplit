export default function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-gray-50">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-sm text-gray-500">
        <p>
          © {new Date().getFullYear()} NairaBulk — Bulk buy tech, pay less.
        </p>
        <p>Made for Nigeria 🇳🇬</p>
      </div>
    </footer>
  );
}
