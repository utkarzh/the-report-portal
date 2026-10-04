"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Button from "@/components/ui/Button";

interface ArticleType {
  id: string;
  name: string;
  additional_instructions: string;
}

export default function ArticleTypesManager({
  initial,
}: {
  initial: ArticleType[];
}) {
  const router = useRouter();
  const [articleTypes, setArticleTypes] = useState(initial);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  async function refresh() {
    const res = await fetch("/api/copywriting/admin/article-types");
    const data = await res.json().catch(() => ({}));
    setArticleTypes(data.articleTypes || []);
  }

  async function create() {
    if (!name.trim()) return setError("Article type field is required");
    setCreating(true);
    setError(null);
    const res = await fetch("/api/copywriting/admin/article-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, additionalInstructions: instructions }),
    });
    setCreating(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error || "Failed to create");
    setName("");
    setInstructions("");
    await refresh();
    router.refresh();
  }

  async function removeSelected() {
    setRemoving(true);
    await Promise.all(
      selected.map((id) =>
        fetch(`/api/copywriting/admin/article-types/${id}`, {
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
        <h2 className="text-sm font-semibold text-gray-900 mb-4">
          Add an article type
        </h2>
        <Input
          label="Article type"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mb-4"
        />
        <Textarea
          label="Additional instructions"
          hint="optional"
          rows={3}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          className="mt-5"
        />
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        <div className="mt-4 flex justify-end">
          <Button size="sm" onClick={create} loading={creating}>
            <Plus size={13} className="mr-1.5 inline" /> Add article type
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
          {articleTypes.length} article type
          {articleTypes.length === 1 ? "" : "s"}
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

      <div className="flex flex-col gap-2">
        {articleTypes.map((t) => (
          <div
            key={t.id}
            className="flex items-start gap-3 bg-white border border-[#e5e3df] px-4 py-3.5"
          >
            <input
              type="checkbox"
              checked={selected.includes(t.id)}
              onChange={() => toggle(t.id)}
              className="mt-1"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">{t.name}</p>
              {t.additional_instructions && (
                <p className="text-xs text-gray-500 mt-1 whitespace-pre-wrap">
                  {t.additional_instructions}
                </p>
              )}
            </div>
          </div>
        ))}
        {articleTypes.length === 0 && (
          <p className="text-sm text-gray-400">No article types yet.</p>
        )}
      </div>
    </div>
  );
}
