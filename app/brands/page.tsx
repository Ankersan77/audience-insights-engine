import { AppShell } from "@/src/components/AppShell";
import { PageHeader } from "@/src/components/PageHeader";
import { requireSession } from "@/src/lib/auth";
import { listBrands, listMarkets } from "@/src/db/queries/brands";
import { BrandsTable } from "./BrandsTable";
import { isAdmin } from "@/src/lib/roles";

export const dynamic = "force-dynamic";

export default async function BrandsPage() {
  const session = await requireSession("/brands");
  const [brands, markets] = await Promise.all([listBrands(session.clientId), listMarkets()]);

  return (
    <AppShell user={session}>
      <PageHeader
        title="Brands"
        description="Every brand this tool runs research for, with its readiness to trigger a run."
      />
      <BrandsTable initialBrands={brands} markets={markets} isAdmin={isAdmin(session)} />
    </AppShell>
  );
}
