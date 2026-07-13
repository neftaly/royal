# Multiplayer FPS Physics Engine Research

This note evaluates JavaScript/WASM physics engines that Royal could demo for a
multiplayer FPS-style simulation. The focus is not just "can it collide
objects", but whether it has a credible multiplayer story.

Unit boundary: Royal positions, sizes, distances, and picking results are
metres (`1 Royal world unit = 1 m`). A physics adapter must expose that same
scale to Royal and the network protocol; any engine-specific scaling belongs at
one explicit adapter boundary. Velocities are therefore metres per second and
accelerations are metres per second squared. Fixed-step durations remain
seconds and angles remain radians.

## Local Constraints From Patchpit Research

The Patchpit notes are useful guardrails:

- Keep transport, authority, interest policy, and renderer patches separate.
- Use P2P3V only for a narrow reliable dynamic-state event log: deterministic
  event reducers, causal cursors, snapshots, missing-event reconciliation, and
  scheduled deterministic events.
- Do not expose peer identity, signaling, WebRTC mesh topology, or authority
  policy through renderer-core.
- Do not make full mesh WebRTC, peer authority for combat-critical state, or
  global deterministic lockstep the default model.
- Test sync through a deterministic fake network before relying on real sockets.
  The fake network should cover seeded delivery, delay, drop, duplicate, reorder,
  backpressure, chunking, reconnect, and malicious peers.
- The browser P2P path should start with WebRTC data channels and explicit
  signaling. Patchpit's first target is non-trickle ICE with two manual QR
  exchanges, plus diagnostics for ICE candidate types, connection time, and
  failure reasons.

Local references:

- `/home/neftaly/dev/patchpit/docs/royal/renderer-v2-target-architecture.md`
- `/home/neftaly/dev/patchpit/docs/royal/v1-to-v2-stub-review.md`
- `/home/neftaly/dev/patchpit/docs/v2/research/network-sync-test-plan.md`
- `/home/neftaly/dev/patchpit/docs/webrtc-serverless-signaling.md`
- `/home/neftaly/dev/patchpit/packages/tarstate/src/fake-network-prototype.ts`

## Physics Needed For A Multiplayer FPS

A multiplayer FPS usually needs less "realistic rigid-body gameplay" than it
appears to need. The critical loop is player movement, collision queries, combat
queries, and robust state correction.

Required physics surface:

- Kinematic or virtual character controller: capsule, slopes, stair stepping,
  ground snap, moving platforms, and stable contact/support reporting.
- Scene queries: ray casts for hitscan, shape/capsule casts for movement and
  lag compensation, overlap checks for triggers and pickups.
- Static environment collision: triangle meshes, height fields, or decomposed
  convex collision; ideally separated from visual meshes.
- Dynamic rigid bodies for props: boxes, barrels, doors, ragdoll pieces, debris.
  These should be low-priority state sync, not required for combat truth.
- Fixed timestep support and explicit simulation parameters.
- Snapshot or serialization hooks for rollback, resync, debugging, and
  cross-runtime determinism probes.

Networking model that fits an FPS:

- Server-authoritative is the default credible model. Clients send input commands
  with sequence numbers. The server owns player state, collision, damage, and
  physics outcomes. Clients predict their own movement, reconcile against server
  snapshots, interpolate remote players, and use lag compensation for hitscan.
- P2P is plausible for small trusted demos, local co-op, or research. For a
  browser demo, use WebRTC data channels for peer transport and keep authority
  narrow: host-authoritative peer or deterministic input/event log for
  non-combat state. Do not use peer authority for competitive combat state.
- Deterministic lockstep is viable only if the engine and all inputs are
  deterministic across browser/Node/runtime versions. It is attractive for
  demos, but fragile for open-world FPS unless the simulation surface is small.
- State synchronization is a pragmatic middle path for interactive props: send
  input plus object state, prioritize important bodies, use jitter buffers, snap
  physics state, and smooth render error visually.

## Interest API Learnings

Patchpit's existing direction is the right one: interest is declarative scene
interest plus interest-derived budget and replication hints, descriptor catalogs,
feature windows, cache keys, invalidations, and a transport/runtime path. It
should not become renderer visibility, and it should not be a hand-coded
distance check inside a physics example.

The Rapier prototype pushed the API shape toward this split:

- Actor descriptors carry an interest policy id, for example
  `walking-player`, `flying-player`, `projectile`, `physics-prop`, or
  `spectator-camera`.
- Policy descriptors define bands and behavior for that actor class. A walking
  player can use short hot/warm blocking-proxy ranges; a flying actor can use
  wider visibility ranges and ghost/no prediction proxy; a projectile can use a
  short lifetime and high-priority event lane.
- Evaluation is a pure policy pass:
  `observer + actor descriptors + policy table -> interest decisions`.
- Stateful behavior should wrap that pure pass rather than replace it. The
  prototype uses `createInterestTracker({ policies })`, with `evaluate` for
  read-only preview and `commit` for the fixed simulation tick. The stored state
  is only actor id, policy id, last band, and exit grace ticks.
- Interest decisions should include at least band, distance, replication yes/no,
  cadence, priority, transport lanes, client-proxy intent, feature-window/cache
  hints, and a reason label for diagnostics.
- Transport consumes those decisions to choose lanes, cadence, coalescing, and
  backpressure behavior. Physics consumes prediction-proxy intent. Rendering
  consumes only the resulting render/debug state.
- Donnybrook-style attention should fit as policy or priority input data. It
  should not be hard-coded into Rapier or renderer code; walking, flying,
  projectiles, spectators, and attention sets can all express different stages,
  lanes, proxy modes, and hysteresis windows.

The API lesson is to keep thresholds and behavior in policy data:

```ts
type InterestPolicy = {
  id: 'walking-player' | 'flying-player' | string;
  stages: readonly {
    band: 'hot' | 'warm' | 'cold';
    cadence: 'every-frame' | 'fast' | 'slow' | 'idle';
    clientProxy: 'blocking' | 'ghost' | 'none';
    lanes: readonly ('transform' | 'animation' | 'combat' | 'full-state')[];
    maxDistance: number;
    priority: number;
    replicated: boolean;
    featureWindow?: string;
    hysteresis?: { exitDistance: number; graceTicks: number };
  }[];
  fallback: {
    band: 'dormant';
    cadence: 'idle';
    clientProxy: 'none';
    lanes: readonly [];
    priority: number;
    replicated: false;
  };
};
```

For stateful hysteresis, the intended use is explicit about when state advances:

```ts
const tracker = createInterestTracker({ policies });

const preview = tracker.evaluate({ actors, observer }); // does not mutate
const frame = tracker.commit({ actors, observer }); // advances hysteresis
```

That maps back to the renderer-v2 boundary: interest policy can emit dynamic
state frames, transform publications, or scene patch batches, but renderer-core
should not know whether an actor was replicated because it was walking, flying,
combat-critical, or inside a Donnybrook attention set.

## Engine Shortlist

### 1. Rapier 3D

Current npm package checked: `@dimforge/rapier3d-compat@0.19.3`.

Why it fits:

- Official JS/WASM bindings from the Rapier project.
- Built-in kinematic character controller with move-and-slide behavior, slopes,
  stairs, snap-to-ground, collision events, and optional impulses to dynamic
  bodies.
- Scene query support for ray casting and shape casting.
- Whole-world snapshot/restore through byte arrays.
- JavaScript docs explicitly claim cross-platform determinism for the
  WASM/TypeScript/JavaScript version, assuming the same version, same initial
  conditions, same construction order, and deterministic inputs.

Multiplayer story:

- Best first candidate for both server-authoritative and narrow P2P experiments.
- For server authority, run the same Rapier world in Node and browser, with the
  browser predicting local character movement and reconciling against server
  snapshots.
- For P2P research, Rapier is the strongest candidate because deterministic
  snapshots can be hashed across peers after fixed ticks. This should still be
  limited to small worlds and controlled inputs.

Caveats:

- Determinism is not magic. Initial data generation must also be deterministic;
  Rapier specifically warns about non-cross-platform math such as JS
  transcendental functions.
- Whole-world snapshots are useful for recovery and tests, but not automatically
  a bandwidth-efficient network format.
- Character feel will still need game-specific movement code above the engine.

Recommendation: first demo target.

Sources:

- https://rapier.rs/docs/user_guides/javascript/getting_started_js/
- https://rapier.rs/docs/user_guides/javascript/character_controller/
- https://rapier.rs/docs/user_guides/javascript/serialization/
- https://rapier.rs/docs/user_guides/javascript/determinism/
- https://registry.npmjs.org/@dimforge%2frapier3d-compat/latest

### 2. JoltPhysics.js

Current npm package checked: `jolt-physics@1.0.0`.

Why it fits:

- WASM port of Jolt Physics, a game/VR-oriented rigid body and collision
  detection engine.
- The upstream engine has strong game-character support: rigid-body character
  and virtual character options.
- JS package exposes multiple entry points: embedded WASM, separate WASM, asm.js,
  debug, and multithreaded variants.
- Upstream Jolt emphasizes deterministic simulation and input replication, with
  limits documented by the project.

Multiplayer story:

- Strong server-authoritative candidate when we want higher-end rigid body
  behavior than Rapier and can accept more integration work.
- Potentially good for deterministic-input replication, but the JS package needs
  a direct probe before relying on cross-runtime determinism. Its build docs
  mention a `CROSS_PLATFORM_DETERMINISTIC` compile option, so verify whether the
  published npm build has the determinism properties we need.
- Good candidate for a "many props / moving platforms / ragdoll stress" demo.

Caveats:

- API mirrors C++ closely and requires explicit WASM memory/reference
  management.
- The JS binding says almost the entire interface is exposed, but demo work must
  verify the exact character, snapshot/state-recorder, and serialization pieces
  available from JS.
- Bigger package and steeper integration than Rapier.

Recommendation: second demo target, especially if Rapier feels too limited for
complex rigid-body interaction.

Sources:

- https://github.com/jrouwe/JoltPhysics.js
- https://github.com/jrouwe/JoltPhysics
- https://registry.npmjs.org/jolt-physics/latest

### 3. Babylon.js Havok

Current npm package checked: `@babylonjs/havok@1.3.13`.

Why it fits:

- WebAssembly Havok package with first-class Babylon.js Physics V2 integration.
- Babylon docs include a physics character controller with capsule setup,
  `moveWithCollisions`, moving/animated platform support, collision observable,
  support checks, desired velocity, integration, and `getPosition`.
- Babylon's Physics V2 docs include body/shape concepts, common collision shapes,
  height fields, meshes, constraints, and performance guidance.

Multiplayer story:

- Good server-authoritative story if the demo is Babylon-based.
- Less compelling for a Royal-native physics demo because the value is tied to
  Babylon's scene and plugin system.
- P2P lockstep story is weak unless we independently prove determinism,
  snapshotting, and browser/Node parity.

Caveats:

- Babylon docs say Havok for web requires WebAssembly SIMD, with older iOS Safari
  caveats.
- The public docs emphasize engine integration, not deterministic multiplayer
  replication.
- Pulling Babylon just for physics would fight Royal's renderer boundary.

Recommendation: use only if we intentionally make a Babylon comparison demo, not
as the first Royal demo.

Sources:

- https://doc.babylonjs.com/features/featuresDeepDive/physics/usingPhysicsEngine
- https://doc.babylonjs.com/features/featuresDeepDive/physics/characterController
- https://registry.npmjs.org/@babylonjs%2fhavok/latest

### 4. PhysX JS WebIDL

Current npm package checked: `physx-js-webidl@2.7.3`.

Why it fits:

- JavaScript/WASM bindings for Nvidia PhysX 5.6.1.
- Bindings claim coverage for static/dynamic actors, major geometry types,
  joints, articulations, vehicles, character controllers, and scene
  serialization.
- Good feature set for a C++-style engine comparison.

Multiplayer story:

- Plausible server-authoritative engine because it has character controllers and
  scene serialization.
- Potentially useful if we need PhysX-specific behavior or want a heavyweight
  comparison.

Caveats:

- Lower-level C++-style API surface.
- Smaller web gameplay ecosystem than Rapier/Jolt/Babylon.
- Deterministic cross-platform lockstep story was not established in this pass.

Recommendation: evaluate after Rapier and Jolt only if we need PhysX features.

Sources:

- https://github.com/fabmax/physx-js-webidl
- https://registry.npmjs.org/physx-js-webidl/latest

### 5. Ammo.js

Current npm package checked: `ammo.js@0.0.10`.

Why it fits:

- Direct Emscripten port of Bullet, with JS and WASM builds.
- Mature Bullet feature heritage: rigid bodies, vehicles, soft body demos,
  triangle terrain examples.
- Many older web game examples and wrappers exist.

Multiplayer story:

- Server-authoritative only, unless we accept significant custom determinism and
  snapshot work.
- Could be useful if we want to compare against legacy Bullet-on-web behavior.

Caveats:

- npm package is very old.
- Upstream README says the npm package tracks Bullet 2.82 with a 2.83 raycast
  fix.
- Binding API is awkward and autogenerated.
- Not a good first choice for a clean modern demo.

Recommendation: skip for first demo.

Sources:

- https://github.com/kripken/ammo.js
- https://registry.npmjs.org/ammo.js/latest

### 6. cannon-es

Current npm package checked: `cannon-es@0.20.0`.

Why it fits:

- Lightweight, pure JavaScript, easy to inspect and bundle.
- Fixed timestep helper and simple rigid body API.
- Good enough for simple bodies, triggers, and transport/state-sync demos.

Multiplayer story:

- Useful for testing network architecture with low physics complexity.
- Server-authoritative snapshots are straightforward because state is plain JS.
- Poor fit for real FPS movement unless we implement our own character controller
  and accept collision-pair limits.

Caveats:

- No built-in FPS-grade character controller.
- Docs list unsupported/todo collision pairs involving trimesh, heightfield,
  convex, and particle combinations.
- Pure JS is easy to run everywhere, but not necessarily ideal for high body
  counts or high-fidelity collision.

Recommendation: use only as a minimal networking shell or fallback demo.

Sources:

- https://pmndrs.github.io/cannon-es/docs/
- https://github.com/pmndrs/cannon-es
- https://registry.npmjs.org/cannon-es/latest

## Transport Notes

Browser P2P:

- WebRTC data channels are the standard browser path for bidirectional
  peer-to-peer arbitrary data.
- Patchpit's manual QR signaling approach is reasonable for a first no-server
  same-room pairing demo, but real NAT traversal still needs STUN/TURN policy
  and diagnostics.

Browser client-server:

- WebTransport is a good modern server transport candidate for unreliable
  UDP-like datagrams plus reliable streams over HTTP/3.
- It is not a peer-to-peer transport. Use it for a server-authoritative physics
  service, not for direct browser peer meshes.

Sources:

- https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel
- https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels
- https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API
- https://developer.mozilla.org/en-US/docs/Web/API/WebTransport

## Recommended Demo Sequence

1. Rapier authoritative FPS movement lab.

   Build a small static arena with capsule movement, slopes/stairs, one moving
   platform, hitscan raycast, and a few dynamic props. Run a browser client and a
   Node authority with the same fixed tick. Client sends input commands; server
   sends sequence-stamped player and prop snapshots. Implement local prediction,
   server reconciliation, remote interpolation, and visual error smoothing.

2. Rapier deterministic/P2P probe.

   Use WebRTC data channels or the fake network testkit first. Keep the world
   small. Exchange scheduled input/event logs, hash Rapier snapshots every N
   ticks, and resync from full snapshots on divergence. This tests whether a
   narrow P2P3V-style event lane is viable without implying peer authority for
   combat.

3. Jolt stress comparison.

   Port the same arena shape to JoltPhysics.js and compare character behavior,
   dynamic prop stability, package/init cost, worker viability, and state
   extraction. Verify determinism and snapshot/state recorder support before
   proposing Jolt for P2P.

4. Optional cannon-es transport fixture.

   If the network protocol is not ready, use cannon-es for a stripped-down
   state-sync fixture because it is easy to inspect and mutate. Do not treat it
   as proof of FPS-grade physics.

## Bottom Line

Use Rapier first. It has the cleanest combination of browser/Node WASM
availability, character controller, scene queries, snapshots, and explicit
determinism docs.

Use Jolt second if we want a more ambitious game-physics comparison.

Use Babylon/Havok only for a Babylon-oriented comparison, not as the first Royal
physics dependency.

Keep P2P as a constrained research lane. The credible default for a multiplayer
FPS remains server authoritative with prediction, reconciliation, interpolation,
lag compensation, prioritized prop state sync, and deterministic fake-network
tests.
