import { Link, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";

const Header = (): ReactNode => (
  <header className="examples-header">
    <Link className="examples-brand" to="/">
      <span aria-hidden="true">👑</span>
      <span>Royal</span>
    </Link>
    <nav className="examples-nav" aria-label="Examples">
      <Link
        to="/cube"
        activeProps={{ className: "examples-link active" }}
        className="examples-link"
      >
        Cube
      </Link>
      <Link
        to="/wireframe"
        activeProps={{ className: "examples-link active" }}
        className="examples-link"
      >
        Wireframe
      </Link>
      <Link
        to="/gltf"
        activeProps={{ className: "examples-link active" }}
        className="examples-link"
      >
        glTF
      </Link>
    </nav>
  </header>
);

export const Shell = (): ReactNode => (
  <main className="examples-shell">
    <Header />
    <Outlet />
  </main>
);
