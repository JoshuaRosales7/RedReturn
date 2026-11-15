"use client";
import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode; label: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="empty" role="alert"><b style={{ color: "var(--bad)" }}>{this.props.label} failed to render</b><span className="small">{this.state.error.message}</span><button className="btn sm" onClick={() => this.setState({ error: null })}>Try again</button></div>;
  }
}
