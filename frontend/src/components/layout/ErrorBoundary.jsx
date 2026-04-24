import { Component } from 'react';

/**
 * Page-level error boundary. Wraps each route so a single broken page
 * doesn't blank out the whole SPA. Shows the error with a "Reload" button
 * that resets the boundary (re-mounts children) and a "Home" link.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surface to devtools & any telemetry we add later.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    const msg = this.state.error?.message || String(this.state.error);
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-2xl">⚠️</span>
            <h2 className="text-lg font-semibold text-white">
              Something went wrong on this page
            </h2>
          </div>
          <p className="text-sm text-gray-400 mb-4">
            The page crashed but the rest of A.L.E.C. is still running. You
            can try reloading this view or navigate elsewhere.
          </p>
          <pre className="text-xs text-red-300 bg-black/30 rounded p-3 mb-4 overflow-auto max-h-40">
            {msg}
          </pre>
          <div className="flex gap-2">
            <button
              onClick={this.reset}
              className="px-4 py-2 rounded-lg bg-alec-accent hover:bg-alec-accent/80 text-black text-sm font-medium transition-colors"
            >
              Retry
            </button>
            <a
              href="/chat"
              className="px-4 py-2 rounded-lg bg-alec-700 hover:bg-alec-600 text-white text-sm transition-colors"
            >
              Go to Chat
            </a>
          </div>
        </div>
      </div>
    );
  }
}
