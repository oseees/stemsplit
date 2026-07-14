import { createRouteHandler } from "uploadthing/next";
import { ourFileRouter } from "./core";

// Serves the UploadThing client/server handshake at /api/uploadthing.
export const { GET, POST } = createRouteHandler({ router: ourFileRouter });
