/** One source reserves either active preparation or a decoded CPU handoff. */
export type TextureReservation =
  | Readonly<{ phase: "preparing" }>
  | Readonly<{ phase: "handoff"; bytes: number }>
  | undefined;
export const preparingTextureReservation = { phase: "preparing" } as const;
export type TextureReservationTotals = {
  activePreparations: number;
  sourceReservations: number;
  decodedHandoffBytes: number;
};

/** Deterministic accounting over caller-owned storage; no scheduling or resource effects. */
export const replaceTextureReservationInto = (
  totals: TextureReservationTotals,
  previous: TextureReservation,
  next: TextureReservation,
): void => {
  totals.activePreparations +=
    Number(next?.phase === "preparing") - Number(previous?.phase === "preparing");
  totals.sourceReservations += Number(next !== undefined) - Number(previous !== undefined);
  totals.decodedHandoffBytes +=
    (next?.phase === "handoff" ? next.bytes : 0) -
    (previous?.phase === "handoff" ? previous.bytes : 0);
};

/** One oversized handoff is allowed to make progress, then further starts wait for release. */
export const canReserveTextureSource = (
  totals: Readonly<TextureReservationTotals>,
  activeLimit: number,
  sourceLimit: number,
  byteThreshold: number,
): boolean =>
  totals.activePreparations < activeLimit &&
  totals.sourceReservations < sourceLimit &&
  (totals.sourceReservations === totals.activePreparations ||
    totals.decodedHandoffBytes < byteThreshold);
