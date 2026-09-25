import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { NoteDto } from "../../shared/api";
import { api, errorText } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useToast } from "./Toast";
import { Button, Card, EmptyState } from "./ui";

/** Notes are plain text and rendered as text (never HTML). */
export function NotesPanel({ domainId }: { domainId: number }) {
  const client = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const notes = useQuery({
    queryKey: ["notes", domainId],
    queryFn: () => api.get<{ items: NoteDto[] }>(`/domains/${domainId}/notes`),
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["notes", domainId] });
    void client.invalidateQueries({ queryKey: ["domains"] });
  };
  const onError = (error: unknown) => toast(errorText(error), "error");

  const add = useMutation({
    mutationFn: (note: string) => api.post<NoteDto>(`/domains/${domainId}/notes`, { note }),
    onSuccess: () => {
      setDraft("");
      refresh();
    },
    onError,
  });
  const update = useMutation({
    mutationFn: ({ id, text }: { id: number; text: string }) => api.put<NoteDto>(`/domains/${domainId}/notes/${id}`, { note: text }),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete<void>(`/domains/${domainId}/notes/${id}`),
    onSuccess: refresh,
    onError,
  });

  return (
    <Card title="Notes">
      <form
        className="flex gap-2 border-b border-slate-100 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim()) add.mutate(draft.trim());
        }}
      >
        <textarea
          className="input min-h-16"
          placeholder="e.g. Strong exact-match phrase. Check historical use."
          maxLength={5000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" variant="primary" disabled={!draft.trim() || add.isPending} className="self-start">
          Add
        </Button>
      </form>
      {notes.data?.items.length === 0 && <EmptyState title="No notes yet." />}
      <ul className="divide-y divide-slate-100">
        {notes.data?.items.map((note) => (
          <li key={note.id} className="px-3 py-2 text-sm">
            {editing?.id === note.id ? (
              <div className="flex gap-2">
                <textarea className="input" value={editing.text} maxLength={5000} onChange={(e) => setEditing({ id: note.id, text: e.target.value })} />
                <div className="flex flex-col gap-1">
                  <Button size="sm" variant="primary" disabled={!editing.text.trim()} onClick={() => update.mutate({ id: note.id, text: editing.text.trim() })}>
                    Save
                  </Button>
                  <Button size="sm" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <p className="whitespace-pre-wrap text-slate-800">{note.note}</p>
                <div className="mt-1 flex gap-3 text-xs text-slate-500">
                  <span>{formatDateTime(note.updatedAt)}</span>
                  <button className="hover:text-slate-800" onClick={() => setEditing({ id: note.id, text: note.note })}>
                    Edit
                  </button>
                  <button className="hover:text-red-700" onClick={() => remove.mutate(note.id)}>
                    Delete
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
