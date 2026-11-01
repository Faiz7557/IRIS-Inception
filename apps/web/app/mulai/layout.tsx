import "./landing.css";

// Gabarito and Rethink Sans load in the root layout; this only adds the landing's grid and scroll scenes.
export default function MulaiLayout({ children }: { children: React.ReactNode }) {
  return <div className="landing">{children}</div>;
}
