import { Component, type ReactNode } from 'react';
import type { ModeId } from '@config/modes';

interface ModeErrorBoundaryProps {
  children: ReactNode;
  mode: ModeId;
  resetKey: string;
}

interface ModeErrorBoundaryState {
  error: Error | null;
}

export class ModeErrorBoundary extends Component<ModeErrorBoundaryProps, ModeErrorBoundaryState> {
  state: ModeErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ModeErrorBoundaryState {
    return { error };
  }

  componentDidUpdate(prevProps: ModeErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mode mode-error" role="alert">
          <div>
            <h2>{this.props.mode} mode failed</h2>
            <p>{this.state.error.message}</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
