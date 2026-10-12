import { AppShell } from "@/src/components/AppShell";
import { PageHeader } from "@/src/components/PageHeader";
import { requireSession } from "@/src/lib/auth";
import { listInsights, type QueueFilter } from "@/src/db/queries/insights";
import { listBrands } from "@/src/db/queries/brands";
import { InsightsQueue } from "./InsightsQueue";

export const dynamic = "force-dynamic";

const VALID_FILTERS: QueueFilter[] = ["pending", "accepted", "discarded", "delivery-failed"];

function parseFilter(value: string | undefined): QueueFilter {
  return VALID_FILTERS.includes(value as QueueFilter) ? (value as QueueFilter) : "pending";
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; brandId?: string }>;
}) {
  const session = await requireSession("/insights");
  const params = await searchParams;
  const status = parseFilter(params.status);
  const brandId = params.brandId ? Number(params.brandId) : undefined;

  const [insights, brands] = await Promise.all([
    listInsights({ queueFilter: status, brandId: Number.isInteger(brandId) ? brandId : undefined }),
    listBrands(),
  ]);

  return (
    <AppShell user={session}>
      <PageHeader
        title="Insights"
        description="The global review queue, across every brand — accept, edit, discard, or retry a failed delivery."
      />
      <InsightsQueue
        initialInsights={insights}
        brands={brands.map((b) => ({ id: b.id, name: b.name }))}
        isAdmin={session.role === "admin"}
        currentFilter={status}
        currentBrandId={Number.isInteger(brandId) ? (brandId as number) : null}
      />
    </AppShell>
  );
}
