import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type FeatureErrorBoundaryProps = {
  featureName: string;
  children: ReactNode;
};

type FeatureErrorBoundaryState = {
  hasError: boolean;
};

export class FeatureErrorBoundary extends Component<FeatureErrorBoundaryProps, FeatureErrorBoundaryState> {
  state: FeatureErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): FeatureErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(`[ui-error-boundary] ${this.props.featureName}`, error, errorInfo);
  }

  private resetBoundary = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-red-100">
        <div className="text-sm font-semibold">{this.props.featureName} crashed while rendering.</div>
        <div className="mt-1 text-xs text-red-100/90">Retry this section. If it persists, reload the page.</div>
        <Button type="button" size="sm" variant="outline" className="mt-3 border-red-300/60" onClick={this.resetBoundary}>
          Retry Section
        </Button>
      </div>
    );
  }
}
