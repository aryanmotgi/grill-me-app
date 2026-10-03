import { Component, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// One broken screen must never blank the whole window. Wraps the middle of
// the app: on a render error it shows what broke, with a way back, and the
// sidebar and top bar keep working. `resetKey` clears it when you navigate.
// ---------------------------------------------------------------------------

interface Props { children: ReactNode; resetKey: string; onBack: () => void }
interface State { error: Error | null; key: string }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error) {
    console.error("[grill-me] screen crashed:", error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
        <p className="text-[14px] text-ink">This screen hit a problem.</p>
        <p className="text-[12px] text-faint max-w-[520px] font-mono select-text break-words">{error.message}</p>
        <div className="flex gap-2">
          <button className="composer-btn" onClick={this.props.onBack}>Go back</button>
          <button className="composer-btn" onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      </div>
    );
  }
}
