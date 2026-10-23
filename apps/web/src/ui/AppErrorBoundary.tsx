import React from 'react';

interface State { failed: boolean }

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State { return { failed: true }; }

  render() {
    if (this.state.failed) return (
      <main className="recovery-screen">
        <h1>This page could not be displayed</h1>
        <p>Reload the page to try again. If the problem continues, contact the UNLOSS maintainer.</p>
        <button className="button primary" onClick={() => window.location.reload()}>Reload page</button>
      </main>
    );
    return this.props.children;
  }
}
