import { Link } from "react-router";
import { EmptyState } from "../components/ui";

export function NotFoundPage() {
  return (
    <EmptyState title="Page not found">
      <Link className="text-blue-700 underline" to="/">
        Back to the dashboard
      </Link>
    </EmptyState>
  );
}
