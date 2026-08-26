import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Icon } from "./Icon";

export { Icon } from "./Icon";
export type { IconName } from "./Icon";

/* ------------------------------------------------------------------ utils */

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/* ---------------------------------------------------------------- buttons */

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 font-display font-semibold rounded-full transition-colors disabled:opacity-50 disabled:pointer-events-none";

const VARIANTS = {
  primary: "bg-accent text-white hover:bg-accent-dark",
  dark: "bg-ink text-[#F8F5EF] hover:bg-[#3B3630]",
  ghost: "border-2 border-ink text-ink hover:bg-ink hover:text-[#F8F5EF]",
  soft: "bg-surface border border-line2 text-ink hover:border-ink",
  danger: "bg-surface border border-danger-soft text-danger hover:bg-danger-soft",
} as const;

const SIZES = {
  sm: "h-10 px-4 text-sm",
  md: "h-12 px-6 text-[15px]",
  lg: "h-[54px] px-8 text-base",
} as const;

type ButtonStyleProps = {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  full?: boolean;
};

export function buttonClass({
  variant = "primary",
  size = "md",
  full,
}: ButtonStyleProps = {}) {
  return cx(BUTTON_BASE, VARIANTS[variant], SIZES[size], full && "w-full");
}

export function Button({
  variant,
  size,
  full,
  className,
  ...props
}: ButtonStyleProps & ComponentProps<"button">) {
  return (
    <button
      {...props}
      className={cx(buttonClass({ variant, size, full }), className)}
    />
  );
}

export function ButtonLink({
  variant,
  size,
  full,
  className,
  ...props
}: ButtonStyleProps & ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      className={cx(buttonClass({ variant, size, full }), className)}
    />
  );
}

/* ------------------------------------------------------------------ pills */

const PILL_TONES = {
  neutral: "bg-cream text-muted",
  dark: "bg-ink text-white",
  accent: "bg-accent-soft text-accent-dark",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  line: "border border-line2 bg-surface text-ink",
  surface: "bg-surface text-ink shadow-sm",
} as const;

export function Pill({
  tone = "neutral",
  className,
  children,
}: {
  tone?: keyof typeof PILL_TONES;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-extrabold",
        PILL_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ stars */

export function Stars({
  rating,
  size = 15,
  className,
}: {
  rating: number;
  size?: number;
  className?: string;
}) {
  const rounded = Math.round(rating);
  return (
    <span className={cx("inline-flex items-center gap-px", className)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg
          key={i}
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill={i <= rounded ? "var(--color-star)" : "none"}
          stroke="var(--color-star)"
          strokeWidth="1.6"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m12 3 2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.5l6.3-.8L12 3Z" />
        </svg>
      ))}
      <span className="sr-only">{rating} out of 5 stars</span>
    </span>
  );
}

/* ------------------------------------------------------------------ forms */

export const inputClass =
  "h-12 w-full rounded-xl border border-line2 bg-surface px-4 text-[15px] text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

export function Field({
  label,
  hint,
  error,
  htmlFor,
  action,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  htmlFor?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={htmlFor} className="text-[13.5px] font-extrabold">
          {label}
        </label>
        {action}
      </div>
      {children}
      {error ? (
        <span className="text-xs font-semibold text-danger">{error}</span>
      ) : hint ? (
        <span className="text-xs text-muted">{hint}</span>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- sections */

export function SectionHead({
  title,
  href,
  linkText,
}: {
  title: string;
  href?: string;
  linkText?: string;
}) {
  return (
    <div className="mb-6 flex items-baseline justify-between gap-4">
      <h2 className="text-2xl md:text-[27px]">{title}</h2>
      {href && linkText ? (
        <Link
          href={href}
          className="shrink-0 text-sm font-bold text-accent underline underline-offset-2 hover:text-accent-dark"
        >
          {linkText}
        </Link>
      ) : null}
    </div>
  );
}

export function Breadcrumbs({
  items,
}: {
  items: { label: string; href?: string }[];
}) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap gap-2 text-[13px] text-muted">
      {items.map((item, i) => (
        <span key={item.label} className="flex items-center gap-2">
          {item.href ? (
            <Link href={item.href} className="underline underline-offset-2 hover:text-ink">
              {item.label}
            </Link>
          ) : (
            <span aria-current="page">{item.label}</span>
          )}
          {i < items.length - 1 && <span aria-hidden="true">›</span>}
        </span>
      ))}
    </nav>
  );
}

/* ------------------------------------------------------- status / empties */

export function EmptyState({
  icon,
  title,
  body,
  children,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center py-16 text-center">
      {icon}
      <h1 className="mt-7 text-3xl">{title}</h1>
      <p className="mt-2 max-w-md text-muted">{body}</p>
      {children ? <div className="mt-7 flex flex-wrap justify-center gap-3.5">{children}</div> : null}
    </div>
  );
}

export function Alert({
  tone = "info",
  children,
}: {
  tone?: "info" | "error" | "success";
  children: ReactNode;
}) {
  const tones = {
    info: "bg-cream text-muted",
    error: "bg-danger-soft text-danger",
    success: "bg-good-soft text-good",
  };
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "flex items-start gap-2.5 rounded-xl px-4 py-3 text-[13.5px] font-semibold",
        tones[tone],
      )}
    >
      <Icon
        name={tone === "error" ? "help" : tone === "success" ? "check" : "clock"}
        size={17}
        className="mt-px shrink-0"
      />
      <span>{children}</span>
    </div>
  );
}

/* ------------------------------------------------------------- pagination */

/**
 * Page links for a table.
 *
 * Server-rendered links rather than client state, so a page of results is a
 * real URL: it survives a refresh, it can be bookmarked, and the back button
 * does what a person expects. Every admin table uses this one — a table that
 * grows its own pager is how two of them end up disagreeing about what "page 1"
 * means.
 *
 * `hrefFor` keeps this component ignorant of the rest of the query string, so a
 * caller can preserve its own filters without this file knowing they exist.
 */
export function Pagination({
  page,
  pageCount,
  total,
  noun,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  total: number;
  /** Plural, lowercase: "products", "orders". */
  noun: string;
  hrefFor: (page: number) => string;
}) {
  if (pageCount <= 1) {
    return (
      <div className="flex items-center justify-between px-5 py-3.5 text-[13.5px] text-faint">
        <span>
          {total} {noun}
        </span>
      </div>
    );
  }

  // A window around the current page, always showing the first and last.
  const window = new Set<number>([1, pageCount, page, page - 1, page + 1]);
  const pages = [...window]
    .filter((n) => n >= 1 && n <= pageCount)
    .sort((a, b) => a - b);

  const step =
    "inline-flex h-9 min-w-9 items-center justify-center rounded-full px-3 font-display text-[13.5px] font-semibold";

  return (
    <nav
      aria-label={`${noun} pages`}
      className="flex items-center justify-between gap-4 px-5 py-3.5"
    >
      <span className="text-[13.5px] text-faint">
        Page {page} of {pageCount} · {total} {noun}
      </span>

      <div className="flex items-center gap-1.5">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className={cx(step, "border border-line2 bg-surface hover:border-ink")}>
            Previous
          </Link>
        ) : null}

        {pages.map((n, i) => (
          <span key={n} className="flex items-center gap-1.5">
            {i > 0 && n - pages[i - 1] > 1 ? (
              <span className="px-1 text-faint" aria-hidden="true">
                …
              </span>
            ) : null}
            {n === page ? (
              <span aria-current="page" className={cx(step, "bg-ink text-[#F8F5EF]")}>
                {n}
              </span>
            ) : (
              <Link href={hrefFor(n)} className={cx(step, "border border-line2 bg-surface hover:border-ink")}>
                {n}
              </Link>
            )}
          </span>
        ))}

        {page < pageCount ? (
          <Link href={hrefFor(page + 1)} className={cx(step, "border border-line2 bg-surface hover:border-ink")}>
            Next
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

/** Clamp a `?page=` value to something a query can be built from. */
export function pageFromParam(value: string | string[] | undefined, pageCount: number) {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number.parseInt(raw ?? "1", 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, Math.max(1, pageCount));
}
