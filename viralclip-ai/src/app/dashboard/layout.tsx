import { requireUser } from "@/lib/auth";
import { DEMO_MODE } from "@/lib/demo";
import { Sidebar } from "@/components/dashboard/sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { subscription } = await requireUser();
  return (
    <div className="flex min-h-screen">
      <Sidebar tier={subscription?.tier ?? "free"} />
      <main className="flex-1 overflow-x-hidden px-5 py-6 md:px-8">
        {DEMO_MODE && (
          <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-200">
            Demo mode — no login required. Connect Supabase + an AI key in{" "}
            <code>.env</code> and set <code>DEMO_MODE=false</code> to process real videos.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
