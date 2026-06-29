import {
  applyWrites,
  and,
  as,
  booleanField,
  defineSchema,
  eq,
  evaluate,
  fromIndexedObjectSource,
  from,
  idField,
  leftJoin,
  maybe,
  numberField,
  pipe,
  project,
  refField,
  relation,
  stringField,
  write,
  type MutableObjectSourceData,
  type RelationLookup,
  type RelationRef,
  type RelationRow,
  type WritePatch,
} from '@tarstate/core';
import type { AppRouteId } from './routes';

export type ReceptionStatus = 'confirmed' | 'seen' | 'pending';

export type TripRow = {
  readonly id: string;
  readonly icon: string;
  readonly imageUri: string;
  readonly latestMessage: string;
  readonly name: string;
};

export type TravelerRow = {
  readonly id: string;
  readonly name: string;
  readonly tripId: string;
};

export type MessageReceiptRow = {
  readonly id: string;
  readonly status: ReceptionStatus;
  readonly travelerId: string;
  readonly tripId: string;
};

export type TripMessageRow = {
  readonly id: string;
  readonly sequence: number;
  readonly text: string;
  readonly tripId: string;
};

export type TripDraftRow = {
  readonly id: string;
  readonly icon: string;
  readonly imageUri: string;
  readonly isNew: boolean;
  readonly latestMessage: string;
  readonly name: string;
  readonly tripId: string;
};

export type TravelerDraftRow = {
  readonly id: string;
  readonly draftId: string;
  readonly name: string;
};

export type AppUiRow = {
  readonly id: string;
  readonly activeRoute: AppRouteId;
  readonly draftMessage: string;
  readonly messageSeed: number;
  readonly newTravelerName: string;
  readonly newTripSeed: number;
  readonly requireConfirmation: boolean;
  readonly selectedTripId: string;
  readonly sendPush: boolean;
  readonly toast: string;
  readonly travelerSeed: number;
};

export type TravelerView = TravelerRow & {
  readonly receiptStatus: ReceptionStatus;
};

export type TripView = TripRow & {
  readonly messages: readonly TripMessageRow[];
  readonly travelers: readonly TravelerView[];
};

export type TripDraftView = TripDraftRow & {
  readonly travelers: readonly TravelerDraftRow[];
};

export type ExpoHelloState = MutableObjectSourceData & {
  readonly appUi: AppUiRow[];
  readonly messageReceipts: MessageReceiptRow[];
  readonly travelerDrafts: TravelerDraftRow[];
  readonly travelers: TravelerRow[];
  readonly tripMessages: TripMessageRow[];
  readonly tripDrafts: TripDraftRow[];
  readonly trips: TripRow[];
};

export type ExpoHelloStateModelData = {
  readonly draftTrip: TripDraftView | undefined;
  readonly selectedTrip: TripView | undefined;
  readonly trips: readonly TripView[];
  readonly ui: AppUiRow;
};

const TRIP_IMAGE_SVGS = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 480"><rect width="800" height="480" fill="#d9f0f4"/><path d="M0 350h800v130H0z" fill="#1f6f8b"/><path d="M80 340 270 120l160 220z" fill="#274b5d"/><path d="m258 135 45 72-80-14z" fill="#ffffff"/><circle cx="645" cy="105" r="54" fill="#f2b84b"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 480"><rect width="800" height="480" fill="#f5ece1"/><path d="M0 310h800v170H0z" fill="#235a64"/><path d="M120 315c105-90 250-90 360 0s210 92 320 8v157H120z" fill="#87a979"/><rect x="470" y="145" width="170" height="120" rx="16" fill="#bf6d45"/><path d="M455 162h200l-100-74z" fill="#314856"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 480"><rect width="800" height="480" fill="#e8eef5"/><path d="M0 275h800v205H0z" fill="#5e7b67"/><path d="M90 310c60-120 160-180 300-180s248 60 320 180z" fill="#7d8fa3"/><path d="M250 168h190l-95-58z" fill="#f7f9fb"/><path d="M515 232h110v248H515z" fill="#2f4d45"/></svg>',
];

export const DEFAULT_TRIP_IMAGES = TRIP_IMAGE_SVGS.map((svg) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
export const TRIP_IMAGE_COUNT = DEFAULT_TRIP_IMAGES.length;
export const CURRENT_DRAFT_ID = 'current';
export const EMPTY_MESSAGE = 'No messages yet.';
export const MAIN_UI_ID = 'main';

export const expoHelloSchema = defineSchema({
  appUi: relation<AppUiRow>({
    key: 'id',
    fields: {
      id: idField('appUi'),
      activeRoute: stringField(),
      draftMessage: stringField(),
      messageSeed: numberField(),
      newTravelerName: stringField(),
      newTripSeed: numberField(),
      requireConfirmation: booleanField(),
      selectedTripId: stringField(),
      sendPush: booleanField(),
      toast: stringField(),
      travelerSeed: numberField(),
    },
  }),
  messageReceipts: relation<MessageReceiptRow>({
    key: 'id',
    fields: {
      id: idField('messageReceipt'),
      status: stringField(),
      travelerId: refField('travelers.id'),
      tripId: refField('trips.id'),
    },
  }),
  travelerDrafts: relation<TravelerDraftRow>({
    key: 'id',
    fields: {
      id: idField('travelerDraft'),
      draftId: refField('tripDrafts.id'),
      name: stringField(),
    },
  }),
  travelers: relation<TravelerRow>({
    key: 'id',
    fields: {
      id: idField('traveler'),
      name: stringField(),
      tripId: refField('trips.id'),
    },
  }),
  tripMessages: relation<TripMessageRow>({
    key: 'id',
    fields: {
      id: idField('tripMessage'),
      sequence: numberField(),
      text: stringField(),
      tripId: refField('trips.id'),
    },
  }),
  tripDrafts: relation<TripDraftRow>({
    key: 'id',
    fields: {
      id: idField('tripDraft'),
      icon: stringField(),
      imageUri: stringField(),
      isNew: booleanField(),
      latestMessage: stringField(),
      name: stringField(),
      tripId: stringField(),
    },
  }),
  trips: relation<TripRow>({
    key: 'id',
    fields: {
      id: idField('trip'),
      icon: stringField(),
      imageUri: stringField(),
      latestMessage: stringField(),
      name: stringField(),
    },
  }),
});

export const expoHelloWriters = {
  appUi: write(expoHelloSchema.appUi),
  messageReceipts: write(expoHelloSchema.messageReceipts),
  travelerDrafts: write(expoHelloSchema.travelerDrafts),
  travelers: write(expoHelloSchema.travelers),
  tripMessages: write(expoHelloSchema.tripMessages),
  tripDrafts: write(expoHelloSchema.tripDrafts),
  trips: write(expoHelloSchema.trips),
};

const appUi = as(expoHelloSchema.appUi, 'appUi');
const messageReceipt = as(expoHelloSchema.messageReceipts, 'messageReceipt');
const traveler = as(expoHelloSchema.travelers, 'traveler');
const travelerDraft = as(expoHelloSchema.travelerDrafts, 'travelerDraft');
const trip = as(expoHelloSchema.trips, 'trip');
const tripDraft = as(expoHelloSchema.tripDrafts, 'tripDraft');
const tripMessage = as(expoHelloSchema.tripMessages, 'tripMessage');

export const expoHelloQueries = {
  appUi: pipe(
    from(appUi),
    project({
      id: appUi.id,
      activeRoute: appUi.activeRoute,
      draftMessage: appUi.draftMessage,
      messageSeed: appUi.messageSeed,
      newTravelerName: appUi.newTravelerName,
      newTripSeed: appUi.newTripSeed,
      requireConfirmation: appUi.requireConfirmation,
      selectedTripId: appUi.selectedTripId,
      sendPush: appUi.sendPush,
      toast: appUi.toast,
      travelerSeed: appUi.travelerSeed,
    })
  ),
  travelers: pipe(
    from(traveler),
    leftJoin(from(messageReceipt), and(eq(traveler.id, messageReceipt.travelerId), eq(traveler.tripId, messageReceipt.tripId))),
    project({
      id: traveler.id,
      name: traveler.name,
      tripId: traveler.tripId,
      receiptStatus: maybe(messageReceipt.status),
    })
  ),
  travelerDrafts: pipe(
    from(travelerDraft),
    project({
      id: travelerDraft.id,
      draftId: travelerDraft.draftId,
      name: travelerDraft.name,
    })
  ),
  tripDrafts: pipe(
    from(tripDraft),
    project({
      id: tripDraft.id,
      icon: tripDraft.icon,
      imageUri: tripDraft.imageUri,
      isNew: tripDraft.isNew,
      latestMessage: tripDraft.latestMessage,
      name: tripDraft.name,
      tripId: tripDraft.tripId,
    })
  ),
  tripMessages: pipe(
    from(tripMessage),
    project({
      id: tripMessage.id,
      sequence: tripMessage.sequence,
      text: tripMessage.text,
      tripId: tripMessage.tripId,
    })
  ),
  trips: pipe(
    from(trip),
    project({
      id: trip.id,
      icon: trip.icon,
      imageUri: trip.imageUri,
      latestMessage: trip.latestMessage,
      name: trip.name,
    })
  ),
} as const;

export const INITIAL_TRIP_ROWS: readonly TripRow[] = [
  {
    id: 'queenstown',
    icon: 'Q',
    imageUri: DEFAULT_TRIP_IMAGES[0] ?? '',
    latestMessage: 'Accommodation shortlist is ready.',
    name: 'Queenstown planning trip',
  },
  {
    id: 'wellington',
    icon: 'W',
    imageUri: DEFAULT_TRIP_IMAGES[1] ?? '',
    latestMessage: 'Dinner booking confirmed for Friday.',
    name: 'Wellington weekend',
  },
  {
    id: 'rotorua',
    icon: 'R',
    imageUri: DEFAULT_TRIP_IMAGES[2] ?? '',
    latestMessage: 'Bring rain jackets and walking shoes.',
    name: 'Rotorua family visit',
  },
];

export const INITIAL_TRAVELER_ROWS: readonly TravelerRow[] = [
  { id: 'mia', name: 'Mia', tripId: 'queenstown' },
  { id: 'noah', name: 'Noah', tripId: 'queenstown' },
  { id: 'ava', name: 'Ava', tripId: 'queenstown' },
  { id: 'leo', name: 'Leo', tripId: 'queenstown' },
  { id: 'sofia', name: 'Sofia', tripId: 'wellington' },
  { id: 'ethan', name: 'Ethan', tripId: 'wellington' },
  { id: 'isla', name: 'Isla', tripId: 'rotorua' },
  { id: 'jack', name: 'Jack', tripId: 'rotorua' },
  { id: 'ruby', name: 'Ruby', tripId: 'rotorua' },
];

export const INITIAL_MESSAGE_RECEIPT_ROWS: readonly MessageReceiptRow[] = [
  { id: 'queenstown:mia', status: 'confirmed', travelerId: 'mia', tripId: 'queenstown' },
  { id: 'queenstown:noah', status: 'seen', travelerId: 'noah', tripId: 'queenstown' },
  { id: 'queenstown:ava', status: 'pending', travelerId: 'ava', tripId: 'queenstown' },
  { id: 'queenstown:leo', status: 'pending', travelerId: 'leo', tripId: 'queenstown' },
  { id: 'wellington:sofia', status: 'confirmed', travelerId: 'sofia', tripId: 'wellington' },
  { id: 'wellington:ethan', status: 'confirmed', travelerId: 'ethan', tripId: 'wellington' },
  { id: 'rotorua:isla', status: 'seen', travelerId: 'isla', tripId: 'rotorua' },
  { id: 'rotorua:jack', status: 'pending', travelerId: 'jack', tripId: 'rotorua' },
  { id: 'rotorua:ruby', status: 'confirmed', travelerId: 'ruby', tripId: 'rotorua' },
];

export const INITIAL_TRIP_MESSAGE_ROWS: readonly TripMessageRow[] = [
  { id: 'queenstown-1', sequence: 1, text: 'Flights are held for Tuesday morning.', tripId: 'queenstown' },
  { id: 'queenstown-2', sequence: 2, text: 'Accommodation shortlist is ready.', tripId: 'queenstown' },
  { id: 'wellington-1', sequence: 1, text: 'Train seats are booked.', tripId: 'wellington' },
  { id: 'wellington-2', sequence: 2, text: 'Dinner booking confirmed for Friday.', tripId: 'wellington' },
  { id: 'rotorua-1', sequence: 1, text: 'Thermal walk is booked for Saturday.', tripId: 'rotorua' },
  { id: 'rotorua-2', sequence: 2, text: 'Bring rain jackets and walking shoes.', tripId: 'rotorua' },
];

export const INITIAL_APP_UI_ROW: AppUiRow = {
  id: MAIN_UI_ID,
  activeRoute: 'home-screen',
  draftMessage: '',
  messageSeed: 1,
  newTravelerName: '',
  newTripSeed: 1,
  requireConfirmation: true,
  selectedTripId: 'queenstown',
  sendPush: true,
  toast: '',
  travelerSeed: 1,
};

const STATE_RELATIONS = [
  'appUi',
  'messageReceipts',
  'travelerDrafts',
  'travelers',
  'tripMessages',
  'tripDrafts',
  'trips',
] as const;

export function receiptId(tripId: string, travelerId: string): string {
  return `${tripId}:${travelerId}`;
}

export function defaultTripImage(seed: number): string {
  return DEFAULT_TRIP_IMAGES[seed % TRIP_IMAGE_COUNT] ?? DEFAULT_TRIP_IMAGES[0] ?? '';
}

export function createInitialExpoHelloState(): ExpoHelloState {
  return {
    appUi: [{ ...INITIAL_APP_UI_ROW }],
    messageReceipts: INITIAL_MESSAGE_RECEIPT_ROWS.map((receipt) => ({ ...receipt })),
    travelerDrafts: [],
    travelers: INITIAL_TRAVELER_ROWS.map((traveler) => ({ ...traveler })),
    tripMessages: INITIAL_TRIP_MESSAGE_ROWS.map((message) => ({ ...message })),
    tripDrafts: [],
    trips: INITIAL_TRIP_ROWS.map((trip) => ({ ...trip })),
  };
}

export function cloneExpoHelloState(state: ExpoHelloState): ExpoHelloState {
  return Object.fromEntries(STATE_RELATIONS.map((name) => [name, state[name].map((row) => ({ ...row }))])) as ExpoHelloState;
}

export function applyExpoHelloWrites(state: ExpoHelloState, patches: Iterable<WritePatch>): ExpoHelloState {
  const nextState = cloneExpoHelloState(state);
  applyWrites(nextState, patches);
  return nextState;
}

function stateLookup(state: ExpoHelloState) {
  const source = fromIndexedObjectSource(state);
  const lookupRows = source.lookup as (lookup: RelationLookup) => Iterable<unknown> | undefined;

  return <Relation extends RelationRef>(
    relation: Relation,
    field: keyof RelationRow<Relation> & string,
    value: unknown
  ): readonly RelationRow<Relation>[] => {
    const rows = lookupRows({ relation, field, value });
    return rows === undefined ? [] : (Array.from(rows) as RelationRow<Relation>[]);
  };
}

export async function evaluateExpoHelloModel(state: ExpoHelloState): Promise<ExpoHelloStateModelData> {
  const source = fromIndexedObjectSource(state);
  const [uiResult, tripResult, travelerResult, messageResult, draftResult, travelerDraftResult] = await Promise.all([
    evaluate(source, expoHelloQueries.appUi),
    evaluate(source, expoHelloQueries.trips),
    evaluate(source, expoHelloQueries.travelers),
    evaluate(source, expoHelloQueries.tripMessages),
    evaluate(source, expoHelloQueries.tripDrafts),
    evaluate(source, expoHelloQueries.travelerDrafts),
  ]);
  const ui = uiResult.rows[0] ?? INITIAL_APP_UI_ROW;
  const travelers = travelerResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    tripId: row.tripId,
    receiptStatus: row.receiptStatus ?? 'pending',
  }));
  const trips = tripResult.rows.map((row) => ({
    ...row,
    messages: messageResult.rows
      .filter((entry) => entry.tripId === row.id)
      .sort((left, right) => left.sequence - right.sequence),
    travelers: travelers.filter((entry) => entry.tripId === row.id),
  }));
  const draft = draftResult.rows.find((row) => row.id === CURRENT_DRAFT_ID);
  const draftTrip =
    draft === undefined
      ? undefined
      : {
          ...draft,
          travelers: travelerDraftResult.rows.filter((entry) => entry.draftId === draft.id),
        };

  return {
    draftTrip,
    selectedTrip: trips.find((entry) => entry.id === ui.selectedTripId),
    trips,
    ui,
  };
}

export function readExpoHelloModel(state: ExpoHelloState): ExpoHelloStateModelData {
  const lookup = stateLookup(state);
  const ui = lookup(expoHelloSchema.appUi, 'id', MAIN_UI_ID)[0] ?? INITIAL_APP_UI_ROW;
  const travelers: TravelerView[] = state.travelers.map((entry) => ({
    ...entry,
    receiptStatus:
      lookup(expoHelloSchema.messageReceipts, 'id', receiptId(entry.tripId, entry.id))[0]?.status ?? 'pending',
  }));
  const trips = state.trips.map((entry) => ({
    ...entry,
    messages: [...lookup(expoHelloSchema.tripMessages, 'tripId', entry.id)].sort(
      (left, right) => left.sequence - right.sequence
    ),
    travelers: travelers.filter((traveler) => traveler.tripId === entry.id),
  }));
  const draft = lookup(expoHelloSchema.tripDrafts, 'id', CURRENT_DRAFT_ID)[0];
  const draftTrip =
    draft === undefined
      ? undefined
      : {
          ...draft,
          travelers: lookup(expoHelloSchema.travelerDrafts, 'draftId', draft.id),
        };

  return {
    draftTrip,
    selectedTrip: trips.find((entry) => entry.id === ui.selectedTripId),
    trips,
    ui,
  };
}

export function clearTripDraftPatches(state: ExpoHelloState): readonly WritePatch[] {
  return [
    ...state.travelerDrafts.map((traveler) => expoHelloWriters.travelerDrafts.delete(traveler.id)),
    ...state.tripDrafts.map((draft) => expoHelloWriters.tripDrafts.delete(draft.id)),
  ];
}

export function createTripDraftPatches(
  state: ExpoHelloState,
  trip: TripView,
  isNew: boolean
): readonly WritePatch[] {
  return [
    ...clearTripDraftPatches(state),
    expoHelloWriters.tripDrafts.upsert({
      id: CURRENT_DRAFT_ID,
      icon: trip.icon,
      imageUri: trip.imageUri,
      isNew,
      latestMessage: trip.latestMessage,
      name: trip.name,
      tripId: trip.id,
    }),
    ...trip.travelers.map((traveler) =>
      expoHelloWriters.travelerDrafts.upsert({
        id: traveler.id,
        draftId: CURRENT_DRAFT_ID,
        name: traveler.name,
      })
    ),
  ];
}

export function newTripDraftFromSeed(seed: number): TripView {
  return {
    id: `trip-${seed}`,
    icon: String(seed),
    imageUri: '',
    latestMessage: EMPTY_MESSAGE,
    messages: [],
    name: `New trip ${seed}`,
    travelers: [],
  };
}

export function saveTripDraftPatches(state: ExpoHelloState, draft: TripDraftView): readonly WritePatch[] {
  const lookup = stateLookup(state);
  const existingReceipts = lookup(expoHelloSchema.messageReceipts, 'tripId', draft.tripId);
  const existingTravelers = lookup(expoHelloSchema.travelers, 'tripId', draft.tripId);
  const draftTravelerIds = new Set(draft.travelers.map((traveler) => traveler.id));
  const receiptByTravelerId = new Map(existingReceipts.map((receipt) => [receipt.travelerId, receipt]));
  const shouldCreateReceipt = (traveler: TravelerDraftRow) =>
    receiptByTravelerId.has(traveler.id) || draft.latestMessage !== EMPTY_MESSAGE;

  return [
    expoHelloWriters.trips.upsert({
      id: draft.tripId,
      icon: draft.icon,
      imageUri: draft.imageUri,
      latestMessage: draft.latestMessage,
      name: draft.name,
    }),
    ...existingTravelers
      .filter((traveler) => !draftTravelerIds.has(traveler.id))
      .map((traveler) => expoHelloWriters.travelers.delete(traveler.id)),
    ...existingReceipts
      .filter((receipt) => !draftTravelerIds.has(receipt.travelerId))
      .map((receipt) => expoHelloWriters.messageReceipts.delete(receipt.id)),
    ...draft.travelers.map((traveler) =>
      expoHelloWriters.travelers.upsert({
        id: traveler.id,
        name: traveler.name,
        tripId: draft.tripId,
      })
    ),
    ...draft.travelers.filter(shouldCreateReceipt).map((traveler) =>
      expoHelloWriters.messageReceipts.upsert({
        id: receiptId(draft.tripId, traveler.id),
        status: receiptByTravelerId.get(traveler.id)?.status ?? 'pending',
        travelerId: traveler.id,
        tripId: draft.tripId,
      })
    ),
    ...clearTripDraftPatches(state),
  ];
}

export function sendTripMessagePatches(
  trip: TripView,
  message: string,
  receiptStatus: ReceptionStatus,
  messageId: string,
  sequence: number
): readonly WritePatch[] {
  return [
    expoHelloWriters.trips.update(trip.id, { latestMessage: message }),
    expoHelloWriters.tripMessages.insert({
      id: messageId,
      sequence,
      text: message,
      tripId: trip.id,
    }),
    ...trip.travelers.map((traveler) =>
      expoHelloWriters.messageReceipts.upsert({
        id: receiptId(trip.id, traveler.id),
        status: receiptStatus,
        travelerId: traveler.id,
        tripId: trip.id,
      })
    ),
  ];
}

export function unconfirmedTravelers(trip: TripView | undefined): readonly TravelerView[] {
  return trip?.travelers.filter((traveler) => traveler.receiptStatus !== 'confirmed') ?? [];
}
