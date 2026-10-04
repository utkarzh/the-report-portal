export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, PenLine, ShieldCheck } from "lucide-react";
import { getProfileFromHeaders } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import EntityCard from "@/components/ui/EntityCard";
import SearchInput from "@/components/ui/SearchInput";
import StatusPill from "@/components/ui/StatusPill";
import ListPagination from "@/components/ui/ListPagination";
import DeleteCopywritingButton from "@/components/copywriting/DeleteCopywritingButton";
import CopywritingFilters from "@/components/copywriting/CopywritingFilters";
import { STAGE_LABELS } from "@/lib/copywriting";
import { orIlikeFilter } from "@/lib/search";
import { formatDayMonthYear } from "@/lib/date-format";

const PAGE_SIZE = 12;

function stageTone(
  stage: string,
): "emerald" | "amber" | "red" | "sky" | "stone" {
  if (stage === "complete") return "emerald";
  if (stage === "failed") return "red";
  if (stage === "upload") return "stone";
  return "amber";
}

export default async function CopywritingHomePage({
  searchParams,
}: {
  searchParams: {
    page?: string;
    search?: string;
    articleType?: string;
    publication?: string;
    status?: string;
  };
}) {
  const profile = getProfileFromHeaders();
  if (!profile) redirect("/login");

  const search =
    typeof searchParams.search === "string" ? searchParams.search.trim() : "";
  const articleType = searchParams.articleType || "";
  const publication = searchParams.publication || "";
  const status = searchParams.status || "";
  const page = Math.max(1, parseInt(searchParams.page || "1", 10));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = createSupabaseServerClient();

  let query = supabase
    .from("copywriting_projects")
    .select(
      "id, draft_name, publication_name, article_type_name, stage, created_at, updated_at",
      { count: "exact" },
    );

  if (profile.role !== "admin") query = query.eq("user_id", profile.id);
  if (search) query = query.or(orIlikeFilter(["draft_name"], search));
  if (articleType) query = query.eq("article_type_name", articleType);
  if (publication) query = query.eq("publication_name", publication);
  if (status === "complete") query = query.eq("stage", "complete");
  else if (status === "in_progress")
    query = query.not("stage", "in", '("complete","failed")');
  else if (status === "failed") query = query.eq("stage", "failed");

  const [
    { data: projects, count },
    { data: publications },
    { data: articleTypes },
  ] = await Promise.all([
    query.order("updated_at", { ascending: false }).range(from, to),
    supabase.from("copywriting_publications").select("name").order("name"),
    supabase.from("copywriting_article_types").select("name").order("name"),
  ]);

  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">
              AI Copywriting Tool
            </h1>
            <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
              Build a full TRC article — from raw sources to a final, exportable
              draft — with Claude for writing and Gemini for outside research
              and fact-checking.
            </p>
          </div>
          <Link href="/copywriting/new" className="flex-shrink-0">
            <span className="inline-flex items-center gap-2 rounded-xl bg-black text-white text-xs font-medium tracking-wider uppercase px-5 py-3 hover:bg-gray-900 transition-colors">
              <Plus size={14} /> New Draft
            </span>
          </Link>
        </div>

        {profile.role === "admin" && (
          <div className="mt-6 rounded-xl border border-[#c8973f]/25 bg-[#fbf7ed] p-4 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 rounded-lg bg-[#c8973f]/10 p-2 text-[#a07530]">
                  <ShieldCheck size={18} />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#a07530]">
                    Admin tools
                  </p>
                  <p className="text-sm text-gray-600 mt-0.5">
                    {" "}
                    Manage Publications, article types, TRC guides and stage
                    prompts for this module.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/copywriting/admin"
                  className="group inline-flex items-center gap-2 rounded-lg border border-[#c8973f]/25 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#c8973f]/50 hover:text-[#a07530] hover:shadow"
                >
                  <ShieldCheck size={14} className="text-[#a07530]" />
                  <span>Admin area</span>
                </Link>
              </div>
            </div>
          </div>
        )}

        <div className="mt-8 flex items-center justify-between gap-4 flex-wrap">
          <SearchInput
            basePath="/copywriting"
            initialValue={search}
            placeholder="Search by draft name…"
          />
          <CopywritingFilters
            basePath="/copywriting"
            articleTypes={(articleTypes || []).map((a) => a.name)}
            publications={(publications || []).map((p) => p.name)}
          />
        </div>

        <div className="mt-6">
          {!projects || projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 border border-dashed border-[#e5e3df] rounded-xl py-20 text-center">
              <PenLine size={22} className="text-gray-300" />
              <p className="text-sm text-gray-500">No drafts yet.</p>
              <Link href="/copywriting/new">
                <span className="inline-flex items-center gap-2 text-xs font-medium tracking-wider uppercase text-black border-b border-black pb-0.5">
                  Start your first draft
                </span>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {projects.map((p, i) => (
                <EntityCard
                  key={p.id}
                  href={`/copywriting/${p.id}`}
                  icon={<PenLine size={16} />}
                  title={p.draft_name}
                  subtitle={`${p.publication_name} · ${p.article_type_name}`}
                  date={formatDayMonthYear(p.updated_at || p.created_at)}
                  badge={
                    <StatusPill
                      label={STAGE_LABELS[p.stage] || p.stage}
                      tone={stageTone(p.stage)}
                    />
                  }
                  footerLabel={
                    p.stage === "complete" ? "View final article" : "Continue"
                  }
                  deleteSlot={
                    profile.role === "admin" ? (
                      <DeleteCopywritingButton
                        projectId={p.id}
                        draftName={p.draft_name}
                      />
                    ) : undefined
                  }
                  index={i}
                />
              ))}
            </div>
          )}
        </div>

        {totalCount > PAGE_SIZE && (
          <ListPagination
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
            pageSize={PAGE_SIZE}
            basePath="/copywriting"
            label="drafts"
            search={search}
          />
        )}
      </div>
    </div>
  );
}
