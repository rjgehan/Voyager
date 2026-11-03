// Catches unexpected render errors per view and offers "Reload view" (DESIGN §6.20).
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  label: string;
  children: ReactNode;
  /** Rendered instead of the error panel (an overlay host shows nothing rather than a panel in the shell's grid). */
  fallback?: ReactNode;
  /** The error clears when one of these changes: the note a panel is about, the page's address. */
  resetKeys?: readonly unknown[];
}

function changed(a: readonly unknown[] = [], b: readonly unknown[] = []): boolean {
  return a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[notesapp] ${this.props.label} crashed`, error, info.componentStack);
  }

  override componentDidUpdate(prevProps: Props, prevState: State): void {
    // Not on the update that caught the error: only once the keys move on from it.
    if (prevState.error !== null && this.state.error !== null && changed(prevProps.resetKeys, this.props.resetKeys)) this.reset();
  }

  private reset = () => this.setState({ error: null });

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <div className="error-panel" role="alert">
        <p className="error-panel-title">Something went wrong in this {this.props.label}.</p>
        <p className="error-panel-detail">{this.state.error.message}</p>
        <button type="button" className="button" onClick={this.reset}>
          Reload view
        </button>
      </div>
    );
  }
}
