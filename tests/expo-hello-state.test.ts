import { describe, expect, it } from 'vitest';
import {
  MAIN_UI_ID,
  applyExpoHelloWrites,
  createInitialExpoHelloState,
  createTripDraftPatches,
  evaluateExpoHelloModel,
  expoHelloWriters,
  newTripDraftFromSeed,
  saveTripDraftPatches,
  sendTripMessagePatches,
} from '../apps/expo-hello/trips';

describe('Expo hello Tarstate model', () => {
  it('saves a new trip draft into the normalized trip and traveler rows', async () => {
    const state = createInitialExpoHelloState();
    const draftTrip = newTripDraftFromSeed(4);
    const withDraft = applyExpoHelloWrites(state, [
      ...createTripDraftPatches(state, draftTrip, true),
      expoHelloWriters.travelerDrafts.insert({ id: 'traveler-99', draftId: 'current', name: 'Priya' }),
      expoHelloWriters.tripDrafts.update('current', { name: 'Sydney launch' }),
    ]);
    const draftModel = await evaluateExpoHelloModel(withDraft);

    expect(draftModel.draftTrip?.name).toBe('Sydney launch');
    expect(draftModel.draftTrip?.travelers.map((traveler) => traveler.name)).toEqual(['Priya']);

    const saved = applyExpoHelloWrites(withDraft, [
      ...saveTripDraftPatches(withDraft, draftModel.draftTrip!),
      expoHelloWriters.appUi.update(MAIN_UI_ID, { activeRoute: 'home-screen' }),
    ]);
    const savedModel = await evaluateExpoHelloModel(saved);

    expect(savedModel.draftTrip).toBeUndefined();
    expect(savedModel.trips.find((trip) => trip.id === 'trip-4')).toMatchObject({
      name: 'Sydney launch',
      latestMessage: 'No messages yet.',
    });
    expect(savedModel.trips.find((trip) => trip.id === 'trip-4')?.travelers.map((traveler) => traveler.name)).toEqual([
      'Priya',
    ]);
  });

  it('updates message receipts separately from traveler membership', async () => {
    const state = createInitialExpoHelloState();
    const model = await evaluateExpoHelloModel(state);
    const queenstown = model.trips.find((trip) => trip.id === 'queenstown');
    expect(queenstown).toBeDefined();

    const updated = applyExpoHelloWrites(
      state,
      sendTripMessagePatches(queenstown!, 'Gate changed to 4B.', 'pending', 'queenstown-message-test', 3)
    );
    const updatedModel = await evaluateExpoHelloModel(updated);
    const updatedTrip = updatedModel.trips.find((trip) => trip.id === 'queenstown');

    expect(updatedTrip?.latestMessage).toBe('Gate changed to 4B.');
    expect(updatedTrip?.messages.map((message) => message.text)).toEqual([
      'Flights are held for Tuesday morning.',
      'Accommodation shortlist is ready.',
      'Gate changed to 4B.',
    ]);
    expect(updatedTrip?.travelers.map((traveler) => traveler.name)).toEqual(['Mia', 'Noah', 'Ava', 'Leo']);
    expect(updatedTrip?.travelers.map((traveler) => traveler.receiptStatus)).toEqual([
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
  });
});
