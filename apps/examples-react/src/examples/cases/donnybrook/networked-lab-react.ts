import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type {
  NetworkedLabFrame,
  NetworkedPhysicsLab,
} from './networked-lab';

const NetworkedLabContext = createContext<NetworkedPhysicsLab | undefined>(undefined);

export const NetworkedLabProvider = ({
  children,
  lab,
}: {
  readonly children: ReactNode;
  readonly lab: NetworkedPhysicsLab;
}): ReactNode => {
  const frameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const run = (): void => {
      if (!lab.isPaused()) {
        lab.step();
      }
      frameRef.current = requestAnimationFrame(run);
    };
    frameRef.current = requestAnimationFrame(run);
    return () => {
      if (frameRef.current !== undefined) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [lab]);

  return createElement(NetworkedLabContext.Provider, { value: lab }, children);
};

export const useNetworkedLab = (): NetworkedPhysicsLab => {
  const lab = useContext(NetworkedLabContext);
  if (lab === undefined) {
    throw new Error('useNetworkedLab must be used within NetworkedLabProvider');
  }
  return lab;
};

export const useNetworkedLabSelector = <Value,>(
  selector: (frame: NetworkedLabFrame) => Value,
): Value => {
  const lab = useNetworkedLab();
  return useSyncExternalStore(
    lab.subscribe,
    () => selector(lab.frame()),
    () => selector(lab.frame()),
  );
};
