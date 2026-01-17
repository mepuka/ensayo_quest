/**
 * Frontend Entry Point
 */
import { createRoot } from "react-dom/client";
import { RegistryProvider } from "@effect-atom/atom-react";
import { App } from "./components/App";

// Import global styles (Tailwind + shadcn theme)
import "./styles/globals.css";

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
