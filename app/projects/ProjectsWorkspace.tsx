"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ResearchProject } from "@/src/core/contracts";

function commaList(value: FormDataEntryValue | null): string[] {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

export function ProjectsWorkspace({ projects, canResearch }: { projects: ResearchProject[]; canResearch: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      name: data.get("name"), decision: data.get("decision"), markets: commaList(data.get("markets")), languages: commaList(data.get("languages")),
    }) });
    const payload = await response.json();
    if (!response.ok) { setError(payload.error ?? "Project could not be created."); return; }
    router.push(`/projects/${payload.project.id}`);
    router.refresh();
  }
  return <div className="flex flex-col gap-6">
    {canResearch ? <div><button onClick={() => setOpen((value) => !value)} className="rounded-md bg-[var(--button-primary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-primary-text)]">{open ? "Cancel" : "New research project"}</button></div> : null}
    {open ? <form onSubmit={create} className="grid gap-4 rounded-lg border border-border bg-surface p-5 md:grid-cols-2">
      <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">Project name<input required name="name" maxLength={160} className="rounded-md border border-border bg-background px-3 py-2 font-normal" /></label>
      <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">Decision to support<textarea required name="decision" maxLength={1000} rows={3} className="rounded-md border border-border bg-background px-3 py-2 font-normal" /></label>
      <label className="flex flex-col gap-1 text-sm font-medium">Markets<input required name="markets" placeholder="DK, SE" className="rounded-md border border-border bg-background px-3 py-2 font-normal" /></label>
      <label className="flex flex-col gap-1 text-sm font-medium">Languages<input required name="languages" placeholder="da, en" className="rounded-md border border-border bg-background px-3 py-2 font-normal" /></label>
      {error ? <p className="text-sm text-[var(--status-danger-text)] md:col-span-2">{error}</p> : null}
      <button className="rounded-md bg-[var(--button-primary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-primary-text)] md:col-span-2">Create durable workroom</button>
    </form> : null}
    <section className="rounded-lg border border-border bg-surface p-5"><h2 className="text-lg font-semibold">Projects</h2><div className="mt-4 grid gap-3 md:grid-cols-2">{projects.map((project) => <Link key={project.id} href={`/projects/${project.id}`} className="rounded-md border border-border p-4 hover:border-[var(--accent)]"><div className="flex justify-between gap-3"><h3 className="font-medium">{project.name}</h3><span className="text-xs text-muted">{project.status}</span></div><p className="mt-2 line-clamp-2 text-sm text-muted">{project.decision}</p><p className="mt-3 text-xs text-muted">{project.markets.join(", ")} · {project.languages.join(", ")}</p></Link>)}{projects.length === 0 ? <p className="text-sm text-muted">No research projects yet.</p> : null}</div></section>
  </div>;
}
