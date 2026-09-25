import { Component, type ErrorInfo, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI error", error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <div role="alert" className="m-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-medium">This view failed to render.</p>
          <p className="mt-1">{this.state.error.message}</p>
          <button className="mt-3 underline" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
