import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";
import { getUser } from "@/lib/auth";
import { checkUploadQuota } from "@/lib/usage";

const f = createUploadthing({
  // Surface the real reason (e.g. quota messages) to the client instead of a
  // generic 500.
  errorFormatter: (err) => ({ message: err.message }),
});

// Browser uploads video bytes straight to UploadThing (no Supabase size cap).
// The middleware authenticates + enforces the monthly upload quota before the
// upload is allowed to start.
export const ourFileRouter = {
  videoUploader: f({ video: { maxFileSize: "1GB", maxFileCount: 1 } })
    .middleware(async () => {
      const ctx = await getUser();
      if (!ctx) throw new UploadThingError("Unauthorized");

      const quota = await checkUploadQuota(
        ctx.userId,
        ctx.subscription?.tier ?? "free",
      );
      if (!quota.allowed) {
        throw new UploadThingError(
          `Monthly upload limit reached (${quota.limit}). Upgrade to continue.`,
        );
      }
      return { userId: ctx.userId };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      // Runs on UploadThing's callback. The client also receives file.ufsUrl.
      return { userId: metadata.userId, url: file.ufsUrl };
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
