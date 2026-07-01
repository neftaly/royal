export type FakeNetworkConfig = {
  readonly jitterTicks: number;
};

export type NetworkLaneConfig = FakeNetworkConfig & {
  readonly latencyTicks: number;
  readonly lossEvery: number;
};

export type NetworkPacket<Payload> = {
  readonly deliverAtTick: number;
  readonly payload: Payload;
  readonly sequence: number;
};

export type EnqueuedPacket<Payload> =
  | {
    readonly dropped: true;
    readonly packet?: never;
  }
  | {
    readonly dropped: false;
    readonly packet: NetworkPacket<Payload>;
  };

export const networkJitterTicks = (
  sequence: number,
  jitterTicks: number,
): number => {
  const jitterRange = jitterTicks * 2 + 1;
  return (sequence * 17) % jitterRange - jitterTicks;
};

export const networkDeliveryTick = (
  baseTick: number,
  config: NetworkLaneConfig,
  sequence: number,
): number => Math.max(
  baseTick,
  baseTick + config.latencyTicks + networkJitterTicks(sequence, config.jitterTicks),
);

export const shouldDropNetworkPacket = (
  sequence: number,
  lossEvery: number,
): boolean => lossEvery > 0 && sequence > 0 && sequence % lossEvery === 0;

export const enqueueNetworkPacket = <Payload>({
  baseTick,
  config,
  payload,
  sequence,
}: {
  readonly baseTick: number;
  readonly config: NetworkLaneConfig;
  readonly payload: Payload;
  readonly sequence: number;
}): EnqueuedPacket<Payload> => {
  if (shouldDropNetworkPacket(sequence, config.lossEvery)) {
    return { dropped: true };
  }

  return {
    dropped: false,
    packet: {
      deliverAtTick: networkDeliveryTick(baseTick, config, sequence),
      payload,
      sequence,
    },
  };
};

export const takeReadyNetworkPackets = <Payload>(
  queue: readonly NetworkPacket<Payload>[],
  tick: number,
): {
  readonly pending: NetworkPacket<Payload>[];
  readonly ready: NetworkPacket<Payload>[];
} => ({
  pending: queue.filter((packet) => packet.deliverAtTick > tick),
  ready: queue.filter((packet) => packet.deliverAtTick <= tick),
});
