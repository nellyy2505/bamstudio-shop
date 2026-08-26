import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, Pill, cx, type IconName } from "@/components/ui";

/**
 * Small pieces the staff screens share.
 *
 * Deliberately thin. Everything here that could be a button, a pill, a field or
 * a pagination bar comes from components/ui — this file only adds the shapes
 * that are specific to a back office (a page heading with actions, a table
 * shell, a row of statistics) and that would otherwise be copied into eight
 * screens with eight slightly different paddings.
 *
 * See WORKLOG: reducing the number of hand-drawn components across the whole
 * front end is a backlog item. Nothing new should be drawn here that a library
 * component already does.
 */

export function PageHead({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-5">
      <div className="min-w-0">
        <h1 className="text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-[14.5px] text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </div>
  );
}

/** A card with a header, for a table or a block of fields. */
export function Panel({
  title,
  note,
  actions,
  children,
  padded = true,
}: {
  title?: string;
  note?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className="card overflow-hidden">
      {title ? (
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[17px]">{title}</h2>
            {note ? <p className="mt-0.5 text-[13px] text-muted">{note}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      <div className={padded ? "p-5" : ""}>{children}</div>
    </section>
  );
}

/**
 * What a table says when it has no rows.
 *
 * Quiet on purpose — an empty table is a normal state for a shop that opened
 * last week, not a failure. components/ui's EmptyState is the full-page version
 * with a 3xl heading; this is the one that sits inside a panel.
 */
export function NoRows({ children }: { children: ReactNode }) {
  return (
    <div className="px-5 py-12 text-center text-[14px] text-muted">{children}</div>
  );
}

/**
 * A number with a label. Only ever shows something counted.
 *
 * `value` is a string so the caller decides how a missing number reads — "—",
 * never a 0 standing in for "we do not know".
 */
export function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: ReactNode;
  tone?: "warn";
}) {
  return (
    <div className={cx("card flex flex-col gap-2 p-5", tone === "warn" && "border-warn-soft bg-warn-soft/50")}>
      <span className="text-[12.5px] font-extrabold tracking-[0.06em] text-faint">{label}</span>
      <span className="font-display text-[30px] leading-none font-semibold tabular-nums">{value}</span>
      {note ? <span className="text-[13.5px] text-muted">{note}</span> : null}
    </div>
  );
}

export function TileLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-[13.5px] font-bold text-accent hover:text-accent-dark">
      {children} →
    </Link>
  );
}

/**
 * A swatch. `title` carries the hex so the exact value is one hover away
 * without putting eighteen hex codes on screen.
 */
export function Swatch({ hex, size = 20 }: { hex: string; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full border border-line2"
      style={{ width: size, height: size, background: hex }}
      title={hex}
      aria-hidden="true"
    />
  );
}

const STATUS_TONE: Record<string, "accent" | "warn" | "neutral" | "good" | "danger"> = {
  confirmed: "accent",
  printing: "warn",
  packed: "neutral",
  shipped: "good",
  delivered: "good",
  cancelled: "danger",
  pending: "neutral",
};

export function StatusPill({ status }: { status: string }) {
  return <Pill tone={STATUS_TONE[status] ?? "neutral"}>{status}</Pill>;
}

export const CHANNEL_LABEL: Record<string, string> = {
  website: "Website",
  market_stall: "Market stall",
  tiktok: "TikTok Shop",
  shopee: "Shopee",
  other: "Other",
};

/**
 * A cost or a price that might not be known.
 *
 * The whole reason this exists: `money(0)` renders "$0.00", which is a
 * statement that something is free. A product nobody has timed or weighed has
 * no cost, and this says so.
 */
export function Unknown({ what }: { what: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-warn">
      <Icon name="help" size={15} />
      {what}
    </span>
  );
}

export function IconBadge({ name, tint }: { name: IconName; tint: string }) {
  return (
    <span
      className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", tint)}
    >
      <Icon name={name} size={20} />
    </span>
  );
}
