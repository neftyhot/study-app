/**
 * A source page as a picture.
 *
 * A GET so an `<img src>` can point at it. The first request for a page
 * rasterizes it and caches the file; later ones are a read, which is why this
 * is safe to put behind a plain image tag.
 */
import { db } from "@/db";
import { RenderError, slideImage } from "@/lib/diagrams/render";

export const maxDuration = 60;

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/slides/[slideId]/image">,
) {
  const { slideId } = await ctx.params;

  try {
    const image = await slideImage(db, slideId);

    return new Response(image.data as BodyInit, {
      headers: {
        "content-type": "image/png",
        // The picture of a page never changes once rendered, and the app is
        // local, so this is cached hard rather than revalidated.
        "cache-control": "private, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    const status = error instanceof RenderError ? 404 : 500;
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status },
    );
  }
}
