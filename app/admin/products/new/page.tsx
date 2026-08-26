import { requireStaff } from "@/lib/auth/staff";
import { getAccessories, getColours, getSettings } from "../../data";
import { PageHead } from "../../ui";
import { ProductForm } from "../ProductForm";
import { Breadcrumbs } from "@/components/ui";

export const metadata = { title: "New product · Studio" };

export default async function NewProductPage() {
  await requireStaff("catalogue");

  const [settings, accessories, colours] = await Promise.all([
    getSettings(),
    getAccessories(),
    getColours(),
  ]);

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Studio", href: "/admin" },
          { label: "Products", href: "/admin/products" },
          { label: "New" },
        ]}
      />
      <PageHead
        title="Add a product"
        subtitle="Photographs come after it is saved — a photo needs something to belong to."
      />
      <ProductForm
        product={null}
        colours={colours}
        accessories={accessories}
        defaultBuffer={settings.defaultBufferStock}
      />
    </div>
  );
}
