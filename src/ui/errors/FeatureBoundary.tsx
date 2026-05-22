// Per-feature error boundary. ModeErrorBoundary wraps the entire active
// mode, but inside a mode we also want a brain canvas crash, a chat
// crash, or a settings crash to NOT take down the rest of the surface.
// Each boundary has its own resetKey + retry, and the caller can pass
// a friendly fallback message.
//
// Why this exists: one bad GLB or one provider 5xx should never blow
// up the whole window. Catch close to the leaf.

import { Component, type ReactNode } from 'react';
import { Icon } from '@ui/icons';
import { bus } from '@core/bus/EventBus';

interface Props {
  name: string;
  children: ReactNode;
  resetKey?: unknown;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class FeatureBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    bus.emit('agent:activity', {
      agentId: 'system',
      phase: 'error',
      detail: `${this.props.name}: ${error.message}`,
    });
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
      return (
        <div className="feature-boundary" role="alert">
          <div className="feature-boundary-icon">
            <Icon name="alert" size={18} />
          </div>
          <div>
            <p className="feature-boundary-title">{this.props.name} stopped responding</p>
            <p className="feature-boundary-detail">{this.state.error.message}</p>
            <button type="button" className="feature-boundary-action" onClick={this.reset}>
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
