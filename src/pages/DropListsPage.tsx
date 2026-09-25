import { Link } from "react-router";
import { Card, EmptyState, ErrorState, LoadingState, PageHeader } from "../components/ui";
import { errorText } from "../lib/api";
import { formatDate, formatDateTime, formatNumber } from "../lib/format";
import { useStats } from "../lib/queries";

export function DropListsPage() {
  const stats = useStats();
  return (
    <>
      <PageHeader
        title="Drop Lists"
        description="Upcoming drop dates from the latest Nominet list. Nominet publishes the list daily; it is checked hourly."
        actions={
          <Link to="/imports" className="text-sm text-blue-700 underline">
            Import history
          </Link>
        }
      />
      <Card title="Upcoming drop dates">
        {stats.isPending ? (
          <LoadingState />
        ) : stats.isError ? (
          <ErrorState message={errorText(stats.error)} onRetry={() => stats.refetch()} />
        ) : stats.data.upcomingDropDates.length === 0 ? (
          <EmptyState title="No upcoming drops.">Import a drop list to populate this view.</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-600">
              <tr>
                <th className="px-4 py-2">Drop date</th>
                <th className="px-4 py-2 text-right">Domains</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {stats.data.upcomingDropDates.map((row) => (
                <tr key={row.dropDate} className="border-t border-slate-100">
                  <td className="px-4 py-2">
                    {formatDate(row.dropDate)} {row.dropDate === stats.data.today && <span className="text-xs text-blue-700">(today)</span>}
                  </td>
                  <td className="tabular px-4 py-2 text-right">{formatNumber(row.count)}</td>
                  <td className="px-4 py-2 text-right">
                    <Link className="text-blue-700 hover:underline" to={`/domains?drop=${row.dropDate}&domainStatus=listed`}>
                      View domains →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {stats.data?.lastImport && (
        <p className="mt-3 text-xs text-slate-500">
          Latest list imported {formatDateTime(stats.data.lastImport.completedAt)} ({formatNumber(stats.data.lastImport.totalRecords)} rows,
          checksum {stats.data.lastImport.checksum?.slice(0, 12)}…).
        </p>
      )}
    </>
  );
}
