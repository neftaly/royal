import { Canvas } from '@royal/react';
import { useEffect, useState, type ReactNode } from 'react';
import { wireframeScene } from './WireframeCube.scene';

const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const useAnimationFrame = (): number => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    let animationFrame = 0;
    let mounted = true;
    const renderFrame = (): void => {
      if (!mounted) return;
      setFrame((current) => current + 1);
      animationFrame = requestAnimationFrame(renderFrame);
    };

    animationFrame = requestAnimationFrame(renderFrame);
    return () => {
      mounted = false;
      cancelAnimationFrame(animationFrame);
    };
  }, []);

  return frame;
};

export const WireframeCube = (): ReactNode => {
  const frame = useAnimationFrame();

  return (
    <Canvas aria-label="Wireframe cube" rootOptions={rootOptions}>
      {wireframeScene(frame)}
    </Canvas>
  );
};
