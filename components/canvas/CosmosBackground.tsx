"use client";

import dynamic from "next/dynamic";
import { Component, type ReactNode } from "react";

const CosmosCanvas = dynamic(
  () => import("@/components/canvas/CosmosCanvas"),
  { ssr: false },
);

/** Error boundary catches runtime WebGL crashes */
class CosmosErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("[CosmosBackground] Runtime error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="cosmos-canvas cosmos-fallback" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo/thefixer-mark.svg"
            alt=""
            className="cosmos-fallback-mark"
          />
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Client-side wrapper that dynamically imports the CosmosCanvas
 * with SSR disabled (Three.js requires browser APIs).
 * Includes error boundary for runtime WebGL crashes.
 */
export default function CosmosBackground() {
  return (
    <CosmosErrorBoundary>
      <CosmosCanvas />
    </CosmosErrorBoundary>
  );
}
