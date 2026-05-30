// Top-level error boundary. ModeErrorBoundary and FeatureBoundary contain
// crashes inside the active mode, but a fault in the shell chrome itself
// (the rail, a store read during render, a bad migration) would otherwise
// unmount the whole tree and leave a white screen. This boundary catches
// that last layer and offers a reload — the reliable escape hatch when
// persisted state is the cause.

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Last-resort log; the bus/store may itself be the failed dependency, so
    // keep this to a plain console write with no app-internal imports.
    // eslint-disable-next-line no-console
    console.error('HashCerebrum root error boundary caught:', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="root-boundary" role="alert">
          <div className="root-boundary-card">
            <h1 className="root-boundary-title">HashCerebrum hit an unexpected error</h1>
            <p className="root-boundary-detail">{this.state.error.message}</p>
            <div className="root-boundary-actions">
              <button type="button" onClick={() => this.setState({ error: null })}>
                Try again
              </button>
              <button type="button" onClick={() => window.location.reload()}>
                Reload app
              </button>
            </div>
            <p className="root-boundary-hint">
              If this keeps happening, reloading clears the in-memory state that triggered it.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
