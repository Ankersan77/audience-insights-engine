"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ResearchProject } from "@/src/core/contracts";

export function ProjectControls({ id, status }: { id: string; status: ResearchProject["status"] }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  async function update(next: ResearchProject["status"]) {
    setSaving(true);
    const response = await fetch(`/api/projects/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) });
    setSaving(false);
    if (response.ok) router.refresh();
  }
  return <div className="flex gap-2">{status === "active" ? <button disabled={saving} onClick={() => void update("completed")} className="rounded-md border border-border px-3 py-2 text-sm">Complete</button> : null}{status !== "archived" ? <button disabled={saving} onClick={() => void update("archived")} className="rounded-md border border-border px-3 py-2 text-sm">Archive</button> : null}{status !== "active" ? <button disabled={saving} onClick={() => void update("active")} className="rounded-md border border-border px-3 py-2 text-sm">Reopen</button> : null}</div>;
}
