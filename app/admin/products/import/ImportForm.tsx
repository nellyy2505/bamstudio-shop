"use client";

import { useMemo, useState } from "react";
import { Alert, Button, cx } from "@/components/ui";
import { money } from "@/lib/format";
import { matchPhotos, parseListings, type ListingEntry } from "@/lib/listings";
import { shrinkPhoto } from "@/lib/shrink-photo";
import { importListing } from "./actions";

export type Existing = {
  sku: string;
  name: string;
  /** cents */
  price: number;
  active: boolean;
  photoCount: number;
};

type RowStatus = { state: "waiting" | "working" | "done" | "failed"; message?: string };

export function ImportForm({ existing }: { existing: Existing[] }) {
  const [entries, setEntries] = useState<ListingEntry[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<Record<string, RowStatus>>({});
  const [running, setRunning] = useState(false);

  const bySku = useMemo(
    () => new Map(existing.map((e) => [e.sku.toLowerCase(), e])),
    [existing],
  );

  const rows = entries.map((entry) => {
    const current = bySku.get(entry.sku.toLowerCase()) ?? null;
    const { matched, missing } = matchPhotos(entry, files);
    const changes: string[] = [];
    if (entry.name !== undefined && entry.name !== current?.name) changes.push("name");
    if (entry.short_name !== undefined) changes.push("short name");
    if (entry.description !== undefined) changes.push("description");
    if (entry.details !== undefined) changes.push("details");
    if (entry.category !== undefined) changes.push("category");
    if (entry.theme !== undefined) changes.push("theme");
    if (entry.weight_grams !== undefined) changes.push("weight");
    if (entry.active !== undefined && entry.active !== current?.active) {
      changes.push(entry.active ? "goes live" : "hidden");
    }
    if (entry.is_new !== undefined) changes.push("new flag");
    if (entry.is_bestseller !== undefined) changes.push("bestseller flag");
    const priceChange =
      entry.price !== undefined && current && Math.round(entry.price * 100) !== current.price
        ? `${money(current.price)} → ${money(Math.round(entry.price * 100))}`
        : entry.price !== undefined && !current
          ? money(Math.round(entry.price * 100))
          : null;
    const canCreate = Boolean(
      entry.slug && entry.name && entry.price !== undefined && entry.weight_grams && entry.category,
    );
    return { entry, current, matched, missing, changes, priceChange, canCreate };
  });

  const usedFiles = new Set(rows.flatMap((r) => r.matched.map((f) => f.name)));
  const unusedFiles = files.filter((f) => !usedFiles.has(f.name));
  const applicable = rows.filter((r) => r.current || r.canCreate);

  async function onListings(file: File | undefined) {
    setStatus({});
    if (!file) return;
    const { entries: parsed, errors: problems } = parseListings(await file.text());
    setEntries(parsed);
    setErrors(problems);
  }

  async function apply() {
    setRunning(true);
    for (const row of applicable) {
      const key = row.entry.sku;
      setStatus((s) => ({ ...s, [key]: { state: "working" } }));
      try {
        const form = new FormData();
        form.set("entry", JSON.stringify(row.entry));
        for (const file of row.matched) form.append("photos", await shrinkPhoto(file));
        const result = await importListing(form);
        setStatus((s) => ({
          ...s,
          [key]: { state: result.ok ? "done" : "failed", message: result.message },
        }));
      } catch (error) {
        setStatus((s) => ({
          ...s,
          [key]: {
            state: "failed",
            message: error instanceof Error ? error.message : "Request failed.",
          },
        }));
      }
    }
    setRunning(false);
  }

  const doneCount = Object.values(status).filter((s) => s.state === "done").length;
  const failedCount = Object.values(status).filter((s) => s.state === "failed").length;

  return (
    <div className="flex flex-col gap-5">
      <div className="card grid gap-5 p-5 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-extrabold">1. Listings file (.json)</span>
          <input
            type="file"
            accept="application/json,.json"
            disabled={running}
            onChange={(e) => onListings(e.target.files?.[0])}
            className="text-[14px]"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-extrabold">2. Photos (optional, select many)</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            multiple
            disabled={running}
            onChange={(e) => {
              setStatus({});
              setFiles(Array.from(e.target.files ?? []));
            }}
            className="text-[14px]"
          />
        </label>
      </div>

      {errors.length > 0 ? (
        <Alert tone="error">
          <b>Some listings were skipped:</b>
          <ul className="mt-1 list-disc pl-5">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {rows.length > 0 ? (
        <div className="card overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead className="border-b border-line text-left text-[12px] text-muted uppercase">
              <tr>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Changes</th>
                <th className="px-4 py-3">Photos</th>
                <th className="px-4 py-3">Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const s = status[row.entry.sku];
                return (
                  <tr key={row.entry.sku} className="border-b border-line align-top last:border-0">
                    <td className="px-4 py-3 font-mono text-[12.5px]">{row.entry.sku}</td>
                    <td className="px-4 py-3">
                      <div className="font-bold">{row.entry.name ?? row.current?.name ?? "?"}</div>
                      {!row.current ? (
                        <div className={cx("text-[12px] font-bold", row.canCreate ? "text-accent-dark" : "text-danger")}>
                          {row.canCreate ? "New product (hidden unless active: true)" : "Not in catalogue, will be skipped"}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {row.priceChange ? <div className="font-bold text-ink">Price {row.priceChange}</div> : null}
                      {row.changes.length ? row.changes.join(", ") : row.priceChange ? null : "No text changes"}
                    </td>
                    <td className="px-4 py-3">
                      {row.matched.length > 0 ? (
                        <div className="flex gap-1.5">
                          {row.matched.slice(0, 5).map((f) => (
                            <Thumb key={f.name} file={f} />
                          ))}
                          {row.matched.length > 5 ? <span className="text-muted">+{row.matched.length - 5}</span> : null}
                        </div>
                      ) : (
                        <span className="text-muted">None</span>
                      )}
                      {row.matched.length > 0 ? (
                        <div className="mt-1 text-[12px] text-muted">
                          {row.entry.replace_photos ? "Replaces" : "Adds to"} {row.current?.photoCount ?? 0} existing
                        </div>
                      ) : null}
                      {row.missing.length > 0 ? (
                        <div className="mt-1 text-[12px] font-bold text-danger">Missing: {row.missing.join(", ")}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {s ? (
                        <span
                          className={cx(
                            "text-[12.5px] font-bold",
                            s.state === "done" && "text-good",
                            s.state === "failed" && "text-danger",
                            s.state === "working" && "text-accent",
                          )}
                        >
                          {s.state === "working" ? "Working…" : s.message}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {unusedFiles.length > 0 && rows.length > 0 ? (
        <Alert tone="info">
          {unusedFiles.length} photo{unusedFiles.length === 1 ? "" : "s"} did not match any listing:{" "}
          {unusedFiles.slice(0, 8).map((f) => f.name).join(", ")}
          {unusedFiles.length > 8 ? "…" : ""}
        </Alert>
      ) : null}

      {rows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-4">
          <Button onClick={apply} disabled={running || applicable.length === 0}>
            {running ? "Applying…" : `Apply ${applicable.length} listing${applicable.length === 1 ? "" : "s"}`}
          </Button>
          {doneCount + failedCount > 0 && !running ? (
            <span className="text-[14px] text-muted">
              {doneCount} done{failedCount ? `, ${failedCount} failed` : ""}.
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Thumb({ file }: { file: File }) {
  const [url] = useState(() => URL.createObjectURL(file));
  // eslint-disable-next-line @next/next/no-img-element -- a local preview of a file not yet uploaded
  return <img src={url} alt={file.name} className="h-12 w-12 rounded-lg object-cover" />;
}
