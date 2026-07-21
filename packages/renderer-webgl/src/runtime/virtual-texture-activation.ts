export type VirtualTextureActivationState = Readonly<{
  generation: number;
  phase: "inactive" | "loading" | "active";
}>;

export const initialVirtualTextureActivationState: VirtualTextureActivationState = {
  generation: 0,
  phase: "inactive",
};

/** Pure activation transition; the root owns import, attachment and disposal effects. */
export const reconcileVirtualTextureActivation = (
  state: VirtualTextureActivationState,
  required: boolean,
): VirtualTextureActivationState => {
  if (required) {
    return state.phase === "inactive"
      ? { generation: state.generation + 1, phase: "loading" }
      : state;
  }
  return state.phase === "inactive" ? state : {
    generation: state.phase === "loading" ? state.generation + 1 : state.generation,
    phase: "inactive",
  };
};

/** Accepts only the completion belonging to the current lazy-import generation. */
export const settleVirtualTextureActivation = (
  state: VirtualTextureActivationState,
  generation: number,
  loaded: boolean,
): VirtualTextureActivationState | undefined => (
  state.phase === "loading" && state.generation === generation
    ? { generation, phase: loaded ? "active" : "inactive" }
    : undefined
);
