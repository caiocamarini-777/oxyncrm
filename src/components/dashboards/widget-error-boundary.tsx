"use client";

import { Component, type ReactNode } from "react";

/** Isola a falha de um widget: os demais continuam na página. */
export class WidgetErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <p role="alert" className="py-6 text-center text-sm text-destructive">
          Não foi possível carregar este widget.
        </p>
      );
    }
    return this.props.children;
  }
}
