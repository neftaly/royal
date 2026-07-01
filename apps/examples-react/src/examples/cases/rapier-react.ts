import { useFrame } from '@royal/react';
import { useEffect, useRef, useState, type RefObject } from 'react';

export type UseRapierSimulationOptions<Simulation, FrameState> = {
  readonly createSimulation: () => Promise<Simulation> | Simulation;
  readonly disposeSimulation: (simulation: Simulation) => void;
  readonly errorFrame: (error: unknown) => FrameState;
  readonly initialFrame: FrameState;
  readonly readSimulation: (simulation: Simulation) => FrameState;
  readonly stepSimulation: (simulation: Simulation) => FrameState;
};

export type UseRapierSimulationResult<Simulation, FrameState> = {
  readonly frame: FrameState;
  readonly simulation: Simulation | undefined;
  readonly simulationRef: RefObject<Simulation | undefined>;
};

export const useRapierSimulation = <Simulation, FrameState>({
  createSimulation,
  disposeSimulation,
  errorFrame,
  initialFrame,
  readSimulation,
  stepSimulation,
}: UseRapierSimulationOptions<Simulation, FrameState>): UseRapierSimulationResult<Simulation, FrameState> => {
  const simulationRef = useRef<Simulation | undefined>(undefined);
  const [frameState, setFrameState] = useState<FrameState>(initialFrame);
  const frame = useFrame();

  useEffect(() => {
    let mounted = true;

    void Promise.resolve(createSimulation())
      .then((simulation) => {
        if (!mounted) {
          disposeSimulation(simulation);
          return;
        }

        simulationRef.current = simulation;
        setFrameState(readSimulation(simulation));
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        setFrameState(errorFrame(error));
      });

    return () => {
      mounted = false;
      if (simulationRef.current !== undefined) {
        disposeSimulation(simulationRef.current);
        simulationRef.current = undefined;
      }
    };
  }, [
    createSimulation,
    disposeSimulation,
    errorFrame,
    readSimulation,
  ]);

  useEffect(() => {
    const simulation = simulationRef.current;
    if (simulation === undefined) return;

    setFrameState(stepSimulation(simulation));
  }, [frame, stepSimulation]);

  return {
    frame: frameState,
    simulation: simulationRef.current,
    simulationRef,
  };
};
