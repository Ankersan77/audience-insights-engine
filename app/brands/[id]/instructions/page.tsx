import { notFound } from "next/navigation";
import { AppShell } from "@/src/components/AppShell";
import { PageHeader } from "@/src/components/PageHeader";
import { requireSession } from "@/src/lib/auth";
import { getBrandById } from "@/src/db/queries/brands";
import {
  getInstructionHistory,
  getLatestInstructionsForBrand,
  listBrandMarkets,
  type ResearchInstructionRow,
} from "@/src/db/queries/research_instructions";
import { InstructionsEditor } from "./InstructionsEditor";
import { isAdmin } from "@/src/lib/roles";

export const dynamic = "force-dynamic";

export default async function BrandInstructionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const brandId = Number(id);
  const session = await requireSession(`/brands/${id}/instructions`);

  if (!Number.isInteger(brandId)) {
    notFound();
  }

  const brand = await getBrandById(brandId, session.clientId);
  if (!brand) {
    notFound();
  }

  const [markets, latestByScope] = await Promise.all([
    listBrandMarkets(brandId),
    getLatestInstructionsForBrand(brandId),
  ]);

  const brandHistory = await getInstructionHistory(brandId, null);
  const marketHistories: Record<number, Awaited<ReturnType<typeof getInstructionHistory>>> = {};
  for (const m of markets) {
    marketHistories[m.id] = await getInstructionHistory(brandId, m.id);
  }

  const latestBrand: ResearchInstructionRow | null = latestByScope.get(null) ?? null;
  const latestMarketByScope: Record<number, ResearchInstructionRow> = {};
  for (const m of markets) {
    const row = latestByScope.get(m.id);
    if (row) latestMarketByScope[m.id] = row;
  }

  return (
    <AppShell user={session}>
      <PageHeader
        title={`Research instructions — ${brand.name}`}
        description="The brand-level default, and any market-specific overrides, a research run reads from."
      />
      <InstructionsEditor
        brandId={brand.id}
        markets={markets}
        latestBrand={latestBrand}
        latestByMarket={latestMarketByScope}
        brandHistory={brandHistory}
        marketHistories={marketHistories}
        isAdmin={isAdmin(session)}
        currentUser={{ name: session.name, email: session.email }}
      />
    </AppShell>
  );
}
