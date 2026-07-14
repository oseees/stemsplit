import { generateReactHelpers } from "@uploadthing/react";
import type { OurFileRouter } from "@/app/api/uploadthing/core";

// Typed client helpers — gives us useUploadThing("videoUploader") in the UI.
export const { useUploadThing, uploadFiles } =
  generateReactHelpers<OurFileRouter>();
