import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

const Index = (): ReactNode => (
  <section className="empty">
    <span>
      Choose an example from the list! Or check out the{" "}
      <Link to="/gltf">helmet 🪖</Link>.
    </span>
  </section>
);

export default Index;
