import type { ReactNode } from "react";
import "./console.css";

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return <div className="console-shell">{children}</div>;
}
