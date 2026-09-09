"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Icon, cx, type IconName } from "@/components/ui";

/**
 * The three jobs a product page does, as three tabs.
 *
 * The page was one long form of sixteen fields serving three different people
 * at three different moments: someone writing the shop copy, someone working out
 * what to charge, and someone looking at what is on the shelf. Split by the job,
 * not by the field type, which is why print time sits under Pricing rather than
 * next to packed weight, and why the cost breakdown moved out of a sidebar and
 * into the tab it explains.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY PANE STAYS MOUNTED. An inactive tab is `hidden`, not unrendered.
 *
 * This is load-bearing, not laziness. The fields are one `<form>` posting to one
 * `saveProduct`, and that action reads every column out of the payload. A pane
 * that was unmounted would send nothing for the fields it owns, and `saveProduct`
 * would write the defaults over them: edit a price on the Pricing tab, save, and
 * the description you never touched is now an empty string. The same trap the
 * Settings screen documents, arrived at from the other direction.
 *
 * Keeping them mounted is what makes one save across three tabs safe.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export type ProductTab = "customer" | "pricing" | "reporting";

/**
 * `null` means "no tabs on this page", and it is the default on purpose.
 *
 * ProductForm is shared with /admin/products/new, which has no tab bar: a page
 * for creating a product should show every field it is about to demand, not
 * hide two thirds of them behind tabs nobody has been introduced to yet. With a
 * default of "customer" that page would have rendered the name and description
 * and silently hidden price, print time and stock, and nothing would have failed
 * loudly - the form would just save a product with no price.
 *
 * So a TabPane with no provider above it shows its content. Forgetting the
 * provider degrades to the old single-column form rather than to a form with
 * fields missing.
 */
const TabContext = createContext<ProductTab | null>(null);

const TABS: { id: ProductTab; label: string; icon: IconName; note: string }[] = [
  {
    id: "customer",
    label: "Customer facing",
    icon: "gift",
    note: "What a shopper sees: the words, the pictures and the colours, with the real page beside them.",
  },
  {
    id: "pricing",
    label: "Pricing",
    icon: "trend",
    note: "What it costs to make, what it should sell for, and what it actually earns.",
  },
  {
    id: "reporting",
    label: "Stock",
    icon: "box",
    note: "What is on the shelf, what is owed, and what to print next.",
  },
];

export function ProductTabs({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<ProductTab>("customer");
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <TabContext.Provider value={tab}>
      <div className="mb-5">
        {/*
          * A tablist rather than links. Tabs deliberately do not change the
          * address: there is one unsaved form underneath spanning all three, and
          * a URL that looked bookmarkable would invite a reload that throws the
          * other two tabs' edits away.
          */}
        <div role="tablist" aria-label="Product" className="flex flex-wrap gap-1.5 border-b border-line">
          {TABS.map((entry) => {
            const active = entry.id === tab;
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(entry.id)}
                className={cx(
                  "-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-[14.5px]",
                  active
                    ? "border-accent font-extrabold text-accent-dark"
                    : "border-transparent text-muted hover:text-ink",
                )}
              >
                <Icon name={entry.icon} size={18} />
                {entry.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2.5 text-[13.5px] text-muted">{current.note}</p>
      </div>

      {children}
    </TabContext.Provider>
  );
}

/**
 * One tab's content. Hidden rather than removed when its tab is not the one on
 * screen, for the reason at the top of this file.
 *
 * `hidden` also takes the pane out of the accessibility tree, so a screen reader
 * reads one tab rather than all three at once, and out of the tab order, so
 * keyboard focus does not walk into an invisible field.
 *
 * Outside a ProductTabs there is nothing to hide behind, so every pane renders.
 * See the note on TabContext.
 */
export function TabPane({
  tab,
  children,
  className,
}: {
  tab: ProductTab;
  children: ReactNode;
  className?: string;
}) {
  const current = useContext(TabContext);
  const active = current === null || current === tab;

  return (
    <div hidden={!active} className={active ? className : undefined}>
      {children}
    </div>
  );
}
