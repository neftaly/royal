/** @jsxImportSource react */
import type { MouseEvent, ReactNode } from 'react';
import { examples } from './examples';
import { exampleHref } from './route-path';

type RouteLinkProps = {
  readonly ariaCurrent?: 'page' | undefined;
  readonly children: ReactNode;
  readonly className: string;
  readonly navigate: (path: string) => void;
  readonly path: string;
};

const RouteLink = ({ ariaCurrent, children, className, navigate, path }: RouteLinkProps): ReactNode => {
  const follow = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(path);
  };
  return <a aria-current={ariaCurrent} className={className} href={exampleHref(path)} onClick={follow}>{children}</a>;
};

export const Shell = ({
  children,
  currentPath,
  navigate,
}: {
  readonly children: ReactNode;
  readonly currentPath: string | undefined;
  readonly navigate: (path: string) => void;
}): ReactNode => (
  <main className="examples-shell">
    <aside className="examples-sidebar">
      <RouteLink className="examples-brand" navigate={navigate} path="/">
        Royal 👑 examples
      </RouteLink>
      <nav className="examples-nav" aria-label="Examples">
        <ul>
          {examples.filter((example) => !('navigation' in example) || example.navigation !== false).map((example) => (
            <li key={example.id}>
              <RouteLink
                ariaCurrent={currentPath === example.path ? 'page' : undefined}
                className={`examples-link${currentPath === example.path ? ' active' : ''}`}
                navigate={navigate}
                path={example.path}
              >
                {example.title}
              </RouteLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
    <div className="examples-main">{children}</div>
  </main>
);
