import type { Metadata } from "next";
import { Poppins, Nunito_Sans } from "next/font/google";
import "./globals.css";
import { headers } from "next/headers";
import { getStaffRole } from "@/lib/auth/staff";
import { PATH_HEADER } from "@/proxy";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { CartProvider } from "@/components/cart/CartProvider";
import { getUser } from "@/lib/supabase/server";
import { isFreeShipping, SHIPPING, SHOP } from "@/lib/config";
import { money } from "@/lib/format";
import { siteUrl } from "@/lib/stripe";
import { SITE_OPEN_GRAPH } from "./seo";

/**
 * §0.10: the description promised "Free Australian shipping from $49" — both
 * unqualified (shippingCost() only waives the standard rate; express is always
 * charged) and with the threshold typed out by hand. Both now come from
 * SHIPPING, and the method is found by asking shippingCost() which one goes
 * free rather than naming it here.
 */
const FREE_RATE_METHOD = SHIPPING.methods.find(
  (option) => isFreeShipping(SHIPPING.freeThreshold, option.id),
);
const FREE_SHIPPING_SENTENCE = FREE_RATE_METHOD
  ? ` Free ${FREE_RATE_METHOD.label.toLowerCase()} post across Australia from ${money(SHIPPING.freeThreshold)}.`
  : "";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

const nunito = Nunito_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-nunito",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${SHOP.name} — cute 3D-printed clickers & charms`,
    template: `%s · ${SHOP.name}`,
  },
  description:
    "Fidget clicker keychains, custom name charms and desk pieces, 3D-printed to order in Sydney." +
    FREE_SHIPPING_SENTENCE,
  /*
   * Shared with every page through `app/seo.ts`, because `openGraph` is
   * REPLACED by the last segment that defines it rather than deep-merged —
   * a page adding its own `og:url` here would otherwise drop siteName and
   * locale. No `url` at this level: og:url is per page, and one set here
   * would claim every page in the shop is the home page.
   */
  openGraph: { ...SITE_OPEN_GRAPH },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  /*
   * The staff area gets none of the shop's chrome.
   *
   * Found by screenshotting it: the studio was rendering inside the shop's
   * promo bar, search, category nav and full footer, so a page for printing
   * parcels carried a "Free AU standard post from $49.00" banner and a link to
   * the returns policy. Worse, it read as a customer page with an admin panel
   * pasted into it — exactly the confusion the dark STAFF bar exists to
   * prevent.
   *
   * `app/admin/layout.tsx` draws its own header and its own sidebar, and it is
   * the only chrome that belongs there.
   */
  const path = (await headers()).get(PATH_HEADER) ?? "";
  const isStaffArea = path === "/admin" || path.startsWith("/admin/");

  /*
   * Two facts the header needs, and the cost of getting them.
   *
   * `signedIn` picks Sign in vs Account. `isStaff` decides whether the Studio
   * link appears at all — it has to be answered here because the `staff` table
   * is unreadable with the anon key the browser holds, so the Header component
   * could not work it out even if it wanted to.
   *
   * The staff lookup is skipped entirely for signed-out visitors, which is
   * nearly all of them, so it costs one extra Supabase request per page view
   * for people with accounts. On the free tier that is a real number, and it is
   * the price of the studio being reachable by clicking rather than by
   * remembering a URL.
   */
  let signedIn = false;
  let isStaff = false;
  try {
    if (!isStaffArea) {
      signedIn = Boolean(await getUser());
      if (signedIn) isStaff = (await getStaffRole()) !== null;
    }
  } catch {
    // Supabase not configured yet, or unreachable. Render the signed-out
    // header and no Studio link — a failed lookup must never grant anything.
  }

  if (isStaffArea) {
    return (
      <html lang="en-AU" className={`${poppins.variable} ${nunito.variable}`}>
        <body className="min-h-screen">{children}</body>
      </html>
    );
  }

  return (
    <html lang="en-AU" className={`${poppins.variable} ${nunito.variable}`}>
      <body className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        <CartProvider>
          <Header signedIn={signedIn} isStaff={isStaff} />
          <main id="main" className="flex-1">
            {children}
          </main>
          <Footer />
        </CartProvider>
      </body>
    </html>
  );
}
