import { useEffect, useState } from 'react';

export const useFrame = (): number => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (
      typeof requestAnimationFrame !== 'function' ||
      typeof cancelAnimationFrame !== 'function'
    ) {
      return;
    }

    let animationFrame = 0;
    let active = true;

    const renderFrame = (): void => {
      if (!active) return;

      setFrame((current) => current + 1);
      animationFrame = requestAnimationFrame(renderFrame);
    };

    animationFrame = requestAnimationFrame(renderFrame);
    return () => {
      active = false;
      cancelAnimationFrame(animationFrame);
    };
  }, []);

  return frame;
};
