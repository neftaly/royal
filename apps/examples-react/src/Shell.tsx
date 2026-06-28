import { Link, Outlet } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { examples } from './examples';

const Sidebar = (): ReactNode => (
  <aside className="examples-sidebar">
    <Link className="examples-brand" to="/">
      <span>Royal</span>
      <span>Examples</span>
    </Link>
    <nav className="examples-nav" aria-label="Examples">
      <ul>
        {examples.map((example) => (
          <li key={example.id}>
            <Link
              to={example.path}
              activeProps={{ className: 'examples-link active' }}
              className="examples-link"
              data-example-id={example.id}
              data-example-nav-link=""
              data-example-route={example.path}
            >
              {example.title}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
    <nav className="examples-nav examples-nav-secondary" aria-label="Research artifacts">
      <p>Research</p>
      <ul>
        <li>
          <Link
            to="/artifacts"
            activeProps={{ className: 'examples-link active' }}
            className="examples-link"
            data-artifacts-nav-link=""
          >
            Research Artifacts
          </Link>
        </li>
      </ul>
    </nav>
  </aside>
);

export const Shell = (): ReactNode => (
  <main className="examples-shell">
    <Sidebar />
    <div className="examples-main">
      <Outlet />
    </div>
  </main>
);
