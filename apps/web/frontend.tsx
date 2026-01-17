/**
 * Frontend Entry Point
 *
 * Renders the App component with AtomProvider for reactive state management.
 * All state is managed via atoms - no legacy useState patterns.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - Migration Strategy
 */
import { createRoot } from "react-dom/client";
import { RegistryProvider } from "@effect-atom/atom-react";
import { App } from "./components/App";

// Import global styles (Tailwind + shadcn theme)
import "./styles/globals.css";

/**
 * Root component with RegistryProvider.
 *
 * RegistryProvider:
 * - Creates the atom registry for this React tree
 * - Enables useAtomValue/useAtomSet hooks to work
 * - Handles atom lifecycle (mount/unmount/cleanup)
 */
function Root() {
  return (
    <RegistryProvider>
      <App />
    </RegistryProvider>
  );
}

// Only render in browser environment (not during test imports)
if (typeof document !== "undefined") {
  const rootElement = document.getElementById("root");
  if (rootElement) {
    createRoot(rootElement).render(<Root />);
  }
}

// Export for testing
export { Root, App };
