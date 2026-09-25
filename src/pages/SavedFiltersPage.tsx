import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { activeFilterCount, filterToSearchParams } from "../../shared/filters";
import { useToast } from "../components/Toast";
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from "../components/ui";
import { api, errorText } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { keys, useSavedFilters } from "../lib/queries";

export function SavedFiltersPage() {
  const filters = useSavedFilters();
  const client = useQueryClient();
  const toast = useToast();
  const remove = useMutation({
    mutationFn: (id: number) => api.delete<void>(`/filters/${id}`),
    onSuccess: () => {
      toast("Filter deleted", "success");
      void client.invalidateQueries({ queryKey: keys.filters });
    },
    onError: (error) => toast(errorText(error), "error"),
  });
  const rename = useMutation({
    mutationFn: ({ id, name, configuration }: { id: number; name: string; configuration: unknown }) =>
      api.put(`/filters/${id}`, { name, configuration }),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.filters }),
    onError: (error) => toast(errorText(error), "error"),
  });

  return (
    <>
      <PageHeader title="Saved Filters" description="Reusable filter configurations. Save new ones from the domain table toolbar." />
      <Card>
        {filters.isPending ? (
          <LoadingState />
        ) : filters.isError ? (
          <ErrorState message={errorText(filters.error)} onRetry={() => filters.refetch()} />
        ) : filters.data.items.length === 0 ? (
          <EmptyState title="No saved filters." />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Configuration</th>
                <th className="px-3 py-2">Updated</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filters.data.items.map((item) => (
                <tr key={item.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 font-medium">{item.name}</td>
                  <td className="px-3 py-2">
                    <code className="text-xs break-all text-slate-600">{filterToSearchParams(item.configuration).toString() || "(no conditions)"}</code>
                    <div className="text-xs text-slate-400">{activeFilterCount(item.configuration)} conditions</div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-500">{formatDateTime(item.updatedAt)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Link className="mr-3 text-blue-700 hover:underline" to={`/domains?${filterToSearchParams(item.configuration).toString() || "all=1"}`}>
                      Apply
                    </Link>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const name = window.prompt("Rename filter", item.name)?.trim();
                        if (name && name !== item.name) rename.mutate({ id: item.id, name, configuration: item.configuration });
                      }}
                    >
                      Rename
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        if (window.confirm(`Delete “${item.name}”?`)) remove.mutate(item.id);
                      }}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
