import { NextResponse } from "next/server";
import { getUser, type SessionContext } from "@/lib/auth";
import { hasFeature, type FeatureKey } from "@/lib/plans";

export function ok<T>(data: T, init?: number) {
  return NextResponse.json(data, { status: init ?? 200 });
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// Wraps a handler: rejects unauthenticated requests, optionally gates a feature.
export function withAuth(
  handler: (req: Request, ctx: SessionContext) => Promise<Response>,
  opts?: { feature?: FeatureKey },
) {
  return async (req: Request) => {
    const ctx = await getUser();
    if (!ctx) return fail("Unauthorized", 401);
    if (opts?.feature && !hasFeature(ctx.subscription?.tier, opts.feature)) {
      return fail("Upgrade required for this feature", 402);
    }
    try {
      return await handler(req, ctx);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Internal error";
      return fail(msg, 500);
    }
  };
}
