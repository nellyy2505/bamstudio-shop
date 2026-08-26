"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Icon, cx } from "@/components/ui";
import { removePhoto, uploadPhotos } from "../actions";

/**
 * The drop zone, and the photos already on the product.
 *
 * There is no panel behind it and no coloured placeholder standing in for
 * pictures that do not exist yet — a product with no photographs shows the drop
 * zone and nothing else. A big empty frame announcing an absence is a worse
 * answer than the thing you use to fix it.
 *
 * A client component because dragging a file onto an area is a browser event
 * with no server-rendered equivalent. The upload itself is the `uploadPhotos`
 * server action, which re-checks staff, re-checks the file type and size, and
 * renames the file — none of which can be trusted to this side.
 */
export function PhotoDrop({
  productId,
  photos,
  publicBase,
}: {
  productId: string;
  photos: { path: string; alt: string }[];
  /** Storage URL prefix, worked out on the server. */
  publicBase: string;
}) {
  const [state, formAction] = useActionState(uploadPhotos, null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);

  // Dropping and picking do the same thing, so both end up here: put the files
  // on the real input and submit. Assigning a DataTransfer's file list is the
  // only way to hand dropped files to a plain form post.
  const accept = (files: FileList | null) => {
    if (!files || files.length === 0 || !input.current) return;
    input.current.files = files;
    form.current?.requestSubmit();
  };

  return (
    <div className="flex flex-col gap-4">
      {photos.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {photos.map((photo) => (
            <figure key={photo.path} className="group relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- Supabase
                  Storage is not configured as a next/image loader, and adding a
                  remote pattern for it would let any path under that host be
                  optimised through this site. */}
              <img
                src={`${publicBase}/${photo.path}`}
                alt={photo.alt}
                className="aspect-square w-full rounded-xl border border-line2 object-cover"
              />
              <RemovePhoto productId={productId} path={photo.path} />
            </figure>
          ))}
        </div>
      ) : null}

      <form ref={form} action={formAction}>
        <input type="hidden" name="id" value={productId} />
        <input
          ref={input}
          type="file"
          name="photos"
          multiple
          accept="image/jpeg,image/png,image/webp,image/avif"
          className="sr-only"
          onChange={(event) => accept(event.target.files)}
        />

        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            accept(event.dataTransfer.files);
          }}
          className={cx(
            "flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors",
            dragging
              ? "border-accent bg-accent-soft"
              : "border-line2 bg-cream/40 hover:border-ink hover:bg-cream",
          )}
        >
          <Icon name="camera" size={26} strokeWidth={1.5} />
          <span className="font-display text-[15px] font-semibold">
            Drop a photo here, or choose one
          </span>
          <span className="text-[13px] text-muted">
            JPEG, PNG, WebP or AVIF, up to 5&nbsp;MB each. Square photographs sit best on the
            shop.
          </span>
          <Pending />
        </button>
      </form>

      {state ? <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert> : null}
    </div>
  );
}

function Pending() {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <span className="mt-1 flex items-center gap-2 text-[13px] font-semibold text-accent">
      <Icon name="spinner" size={16} className="animate-spin" />
      Uploading…
    </span>
  );
}

/*
 * Its own component so each photo gets its own action state — and, more to the
 * point, so `removePhoto` is *called* from a client component rather than
 * *defined* in one. A "use client" file cannot declare a server action;
 * `<form action={someLocalAsyncFunction}>` written here compiles and type-checks
 * and then does nothing useful at runtime.
 */
function RemovePhoto({ productId, path }: { productId: string; path: string }) {
  const [state, formAction] = useActionState(removePhoto, null);

  return (
    <form action={formAction} className="absolute top-2 right-2">
      <input type="hidden" name="id" value={productId} />
      <input type="hidden" name="path" value={path} />
      <RemoveButton />
      {state && !state.ok ? (
        <span className="absolute top-9 right-0 w-40 rounded-lg bg-danger-soft px-2 py-1 text-[11px] font-semibold text-danger">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

function RemoveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label="Remove this photo"
      className="flex h-8 w-8 items-center justify-center rounded-full bg-ink/80 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-50"
    >
      <Icon name={pending ? "spinner" : "trash"} size={15} className={pending ? "animate-spin" : ""} />
    </button>
  );
}
