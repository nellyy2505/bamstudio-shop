import type { Metadata } from "next";
import { Poppins, Nunito_Sans } from "next/font/google";
import "./globals.css";
import { headers } from "next/headers";
import { PATH_HEADER } from "@/proxy";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { CartProvider } from "@/components/cart/CartProvider";
import { getUser } from "@/lib/supabase/server";
import { isFreeShipping, SHIPPING, SHOP } from "@/lib/config";
import { money } from "@/lib/format";
import { siteUrl } from "@/lib/stripe";

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
  openGraph: {
    type: "website",
    siteName: SHOP.name,
    locale: "en_AU",
  },
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

  // Only used to pick the header's Sign in vs Account link.
  let signedIn = false;
  try {
    if (!isStaffArea) signedIn = Boolean(await getUser());
  } catch {
    // Supabase not configured yet — render the signed-out header.
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
          <Header signedIn={signedIn} />
          <main id="main" className="flex-1">
            {children}
          </main>
          <Footer />
        </CartProvider>
      </body>
    </html>
  );
}
