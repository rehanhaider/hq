import { createFileRoute } from "@tanstack/react-router";
import { MAX_UPLOAD_BYTES, formatBytes } from "@/lib/uploads";
import { getUploadStore, uploadFromRequest } from "@/server/uploads";

const tooLarge = `A file may be at most ${formatBytes(MAX_UPLOAD_BYTES)}.`;

/** Multipart framing, well under a megabyte, on top of the file itself. */
const BODY_ALLOWANCE = 1024 * 1024;

export const Route = createFileRoute("/api/uploads")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Refused on the declared length before the body is read, so an
        // oversized video is not buffered into memory only to be rejected.
        const declared = Number(request.headers.get("content-length") ?? 0);
        if (declared > MAX_UPLOAD_BYTES + BODY_ALLOWANCE)
          return Response.json({ error: tooLarge }, { status: 413 });

        let form;
        try {
          form = await uploadFromRequest(request);
        } catch {
          return Response.json({ error: "The upload could not be read." }, { status: 400 });
        }
        if (!form.ok) return Response.json({ error: form.error }, { status: 400 });
        if (form.file.size > MAX_UPLOAD_BYTES)
          return Response.json({ error: tooLarge }, { status: 413 });

        const bytes = new Uint8Array(await form.file.arrayBuffer());
        const result = getUploadStore().save({
          bytes,
          name: form.name,
          mime: form.mime,
          pageId: form.pageId,
        });
        if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
        return Response.json({
          id: result.upload.id,
          url: result.url,
          name: result.upload.name,
          mime: result.upload.mime,
          size: result.upload.size,
        });
      },
    },
  },
});
