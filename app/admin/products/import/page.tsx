import { requireStaff } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/server";
import { ButtonLink, Icon } from "@/components/ui";
import { PageHead, Panel } from "../../ui";
import { ImportForm, type Existing } from "./ImportForm";

export const metadata = { title: "Bulk listings" };

export default async function ImportPage() {
  await requireStaff("catalogue");

  const admin = createAdminClient();
  const { data } = await admin
    .from("products")
    .select("sku, name, price, active, photos")
    .order("sku");

  const existing: Existing[] = (data ?? []).map((row) => ({
    sku: String(row.sku),
    name: String(row.name),
    price: Number(row.price),
    active: Boolean(row.active),
    photoCount: Array.isArray(row.photos) ? row.photos.length : 0,
  }));

  return (
    <div>
      <PageHead
        title="Bulk listings"
        subtitle="Update many products and their photos in one go, from a listings file."
        actions={
          <ButtonLink href="/admin/products/import/export" size="md" variant="soft" prefetch={false}>
            <Icon name="doc" size={18} />
            Download current listings
          </ButtonLink>
        }
      />
      <div className="mb-6">
        <Panel title="How it works">
          <ol className="list-decimal space-y-1.5 pl-5 text-[14px] text-muted">
            <li>Download the current listings, or ask Claude to write a listings file from your photos.</li>
            <li>Choose the listings file and the photos below. Photos are matched by SKU, e.g. <code>CLK-001-1.jpg</code>.</li>
            <li>Check the preview, then apply. Nothing changes until you press Apply.</li>
          </ol>
        </Panel>
      </div>
      <ImportForm existing={existing} />
    </div>
  );
}
