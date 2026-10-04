"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, FileText, Upload, Loader2, Eye } from "lucide-react";
import FileViewerModal from "@/components/copywriting/FileViewerModal";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Button from "@/components/ui/Button";
import { uploadToStorage, type StagedFile } from "@/lib/copywriting-upload";
import { PUBLICATION_GUIDES_BUCKET } from "@/lib/copywriting";

interface Guide {
  id: string;
  filename: string;
  char_count: number;
  truncated: boolean;
  created_at: string;
}

interface Publication {
  id: string;
  name: string;
  country: string | null;
  additional_rules: string;
  copywriting_publication_guides: Guide[];
}

export default function PublicationsManager({
  initial,
}: {
  initial: Publication[];
}) {
  const router = useRouter();
  const [publications, setPublications] = useState(initial);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [rules, setRules] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // "View" target: the guide-file endpoint, or null when closed.
  const [viewing, setViewing] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  async function refresh() {
    const res = await fetch("/api/copywriting/admin/publications");
    const data = await res.json().catch(() => ({}));
    setPublications(data.publications || []);
  }

  async function create() {
    if (!name.trim()) return setError("Publication name is required");
    setCreating(true);
    setError(null);
    const res = await fetch("/api/copywriting/admin/publications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, country, additionalRules: rules }),
    });
    setCreating(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error || "Failed to create");
    setName("");
    setCountry("");
    setRules("");
    await refresh();
    router.refresh();
  }

  async function uploadGuides(publicationId: string, files: FileList | null) {
    if (!files || !files.length) return;
    setUploadingFor(publicationId);
    setUploadError(null);
    // Straight to Supabase Storage from the browser, then the API gets only
    // the paths (no file bytes → no ~4.5 MB Vercel request limit).
    const staged: StagedFile[] = [];
    const failures: string[] = [];
    for (const f of Array.from(files)) {
      try {
        staged.push(await uploadToStorage(PUBLICATION_GUIDES_BUCKET, publicationId, f));
      } catch (e) {
        failures.push(`${f.name}: ${e instanceof Error ? e.message : "Upload failed"}`);
      }
    }
    if (staged.length) {
      const res = await fetch(`/api/copywriting/admin/publications/${publicationId}/guides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: staged }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.errors?.length) failures.push(...data.errors.map((e: { filename: string; error: string }) => `${e.filename}: ${e.error}`));
      else if (!res.ok) failures.push(data.error || "Upload failed");
    }
    if (failures.length) setUploadError(failures.join("; "));
    setUploadingFor(null);
    await refresh();
  }

  async function removeGuide(publicationId: string, guideId: string) {
    await fetch(
      `/api/copywriting/admin/publications/${publicationId}/guides/${guideId}`,
      { method: "DELETE" },
    );
    await refresh();
  }

  async function removeSelected() {
    setRemoving(true);
    await Promise.all(
      selected.map((id) =>
        fetch(`/api/copywriting/admin/publications/${id}`, {
          method: "DELETE",
        }),
      ),
    );
    setRemoving(false);
    setSelected([]);
    await refresh();
    router.refresh();
  }

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="bg-white border border-[#e5e3df] p-6 sm:p-8">
        <h2 className="text-sm font-semibold text-gray-900">
          Add a publication
        </h2>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-5 mb-6">
          <Input
            label="Publication name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            label="Country of publication"
            hint="optional"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          />
        </div>
        <Textarea
          label="Additional rules"
          hint="optional"
          rows={3}
          value={rules}
          onChange={(e) => setRules(e.target.value)}
          className="mt-5"
        />
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        {uploadError && <p className="mt-2 text-xs text-red-500">Guide upload: {uploadError}</p>}
        <div className="mt-4 flex justify-end">
          <Button size="sm" onClick={create} loading={creating}>
            <Plus size={13} className="mr-1.5 inline" /> Add publication
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
          {publications.length} publication
          {publications.length === 1 ? "" : "s"}
        </p>
        {selected.length > 0 && (
          <Button
            size="sm"
            variant="danger"
            onClick={removeSelected}
            loading={removing}
          >
            <Trash2 size={13} className="mr-1.5 inline" /> Remove selected (
            {selected.length})
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {publications.map((p) => (
          <div key={p.id} className="bg-white border border-[#e5e3df] p-6">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={selected.includes(p.id)}
                onChange={() => toggle(p.id)}
                className="mt-1"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">
                  {p.name}
                  {p.country ? ` · ${p.country}` : ""}
                </p>
                {p.additional_rules && (
                  <p className="text-xs text-gray-500 mt-1 whitespace-pre-wrap">
                    {p.additional_rules}
                  </p>
                )}

                <div className="mt-3 flex flex-col gap-1.5">
                  {(p.copywriting_publication_guides || []).map((g) => (
                    <div
                      key={g.id}
                      className="flex items-center justify-between gap-2 text-xs bg-gray-50 px-3 py-2 rounded"
                    >
                      <span className="flex items-center gap-1.5 min-w-0 text-gray-600">
                        <FileText size={12} className="flex-shrink-0" />
                        <span className="truncate">{g.filename}</span>
                      </span>
                      <span className="flex flex-shrink-0 items-center gap-3">
                        <button
                          onClick={() => setViewing(`/api/copywriting/admin/publications/${p.id}/guides/${g.id}`)}
                          className="inline-flex items-center gap-1 text-gray-500 hover:text-black"
                        >
                          <Eye size={12} /> View
                        </button>
                        <button
                          onClick={() => removeGuide(p.id, g.id)}
                          className="text-gray-400 hover:text-red-500"
                          aria-label="Remove"
                        >
                          <Trash2 size={12} />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>

                <label className="mt-3 inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-black cursor-pointer transition-colors">
                  {uploadingFor === p.id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Upload size={12} />
                  )}
                  Add guide (.pdf, .docx)
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.docx"
                    className="hidden"
                    onChange={(e) => uploadGuides(p.id, e.target.files)}
                  />
                </label>
              </div>
            </div>
          </div>
        ))}
        {publications.length === 0 && (
          <p className="text-sm text-gray-400">No publications yet.</p>
        )}
      </div>
      <FileViewerModal endpoint={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
