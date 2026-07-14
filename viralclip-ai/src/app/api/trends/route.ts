import { withAuth, ok } from "@/lib/api";
import { getTrendCenter } from "@/lib/ai/trends";
import { recordUsage } from "@/lib/usage";

export const GET = withAuth(async (_req, ctx) => {
  const data = await getTrendCenter(ctx.profile?.niche);
  await recordUsage(ctx.userId, { aiCalls: 1 });
  return ok(data);
});
