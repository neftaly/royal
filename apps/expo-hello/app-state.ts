import { useMemo, useState } from 'react';
import type { AppRouteId } from './routes';
import {
  MAIN_UI_ID,
  applyExpoHelloWrites,
  clearTripDraftPatches,
  createInitialExpoHelloState,
  createTripDraftPatches,
  expoHelloWriters,
  newTripDraftFromSeed,
  readExpoHelloModel,
  saveTripDraftPatches,
  sendTripMessagePatches,
  unconfirmedTravelers,
  type AppUiRow,
  type ExpoHelloState,
  type ExpoHelloStateModelData,
  type ReceptionStatus,
} from './trips';
import type { WritePatch } from '@tarstate/core';

export type ExpoHelloActions = {
  readonly addTraveler: () => void;
  readonly addTrip: () => void;
  readonly cancelTripEdit: () => void;
  readonly deleteTraveler: (travelerId: string) => void;
  readonly dismissToast: () => void;
  readonly goHome: () => void;
  readonly navigate: (route: AppRouteId) => void;
  readonly nudgeUnconfirmed: () => void;
  readonly openTrip: (tripId: string) => void;
  readonly saveTripEdit: () => void;
  readonly sendMessage: () => void;
  readonly setDraftMessage: (message: string) => void;
  readonly setNewTravelerName: (name: string) => void;
  readonly setRequireConfirmation: (value: boolean) => void;
  readonly setSendPush: (value: boolean) => void;
  readonly setTripImageUri: (imageUri: string) => void;
  readonly setTripName: (name: string) => void;
  readonly showToast: (message: string) => void;
};

export type ExpoHelloStateModel = ExpoHelloStateModelData & {
  readonly actions: ExpoHelloActions;
};

export function useExpoHelloState(): ExpoHelloStateModel {
  const [state, setState] = useState<ExpoHelloState>(() => createInitialExpoHelloState());
  const model = useMemo(() => readExpoHelloModel(state), [state]);

  const commit = (...patches: readonly WritePatch[]) => {
    setState((currentState) => applyExpoHelloWrites(currentState, patches));
  };

  const setUi = (changes: Partial<AppUiRow>) => {
    commit(expoHelloWriters.appUi.update(MAIN_UI_ID, changes));
  };

  const cancelTripEdit = () => {
    commit(
      ...clearTripDraftPatches(state),
      expoHelloWriters.appUi.update(MAIN_UI_ID, {
        activeRoute: 'home-screen',
        newTravelerName: '',
        toast: '',
      })
    );
  };

  const startTripDraft = (isNew: boolean) => {
    if (model.selectedTrip === undefined) return;
    commit(
      ...createTripDraftPatches(state, model.selectedTrip, isNew),
      expoHelloWriters.appUi.update(MAIN_UI_ID, {
        activeRoute: 'add-or-edit-trip',
        newTravelerName: '',
        selectedTripId: model.selectedTrip.id,
        toast: '',
      })
    );
  };

  return {
    ...model,
    actions: {
      addTraveler: () => {
        if (model.draftTrip === undefined) return;

        const name = model.ui.newTravelerName.trim();
        if (name === '') return;

        commit(
          expoHelloWriters.travelerDrafts.insert({
            id: `traveler-${model.ui.travelerSeed}`,
            draftId: model.draftTrip.id,
            name,
          }),
          expoHelloWriters.appUi.update(MAIN_UI_ID, {
            newTravelerName: '',
            travelerSeed: model.ui.travelerSeed + 1,
          })
        );
      },
      addTrip: () => {
        const draftTrip = newTripDraftFromSeed(model.ui.newTripSeed);

        commit(
          ...createTripDraftPatches(state, draftTrip, true),
          expoHelloWriters.appUi.update(MAIN_UI_ID, {
            activeRoute: 'add-or-edit-trip',
            newTravelerName: '',
            newTripSeed: model.ui.newTripSeed + 1,
            selectedTripId: draftTrip.id,
            toast: '',
          })
        );
      },
      cancelTripEdit,
      deleteTraveler: (travelerId) => commit(expoHelloWriters.travelerDrafts.delete(travelerId)),
      dismissToast: () => setUi({ toast: '' }),
      goHome: cancelTripEdit,
      navigate: (route) => {
        if (route === 'add-or-edit-trip') {
          startTripDraft(false);
          return;
        }

        setUi({
          activeRoute: route,
          draftMessage: route === 'message' ? (model.selectedTrip?.latestMessage ?? '') : model.ui.draftMessage,
          toast: '',
        });
      },
      nudgeUnconfirmed: () => {
        const targets = unconfirmedTravelers(model.selectedTrip);
        setUi({
          toast:
            targets.length === 0
              ? 'Push demo toast: everyone has confirmed reception.'
              : `Push demo toast: nudged ${targets.map((traveler) => traveler.name).join(', ')}.`,
        });
      },
      openTrip: (tripId) => {
        const trip = model.trips.find((entry) => entry.id === tripId);
        setUi({
          activeRoute: 'current-message',
          draftMessage: trip?.latestMessage ?? '',
          selectedTripId: tripId,
          toast: '',
        });
      },
      saveTripEdit: () => {
        if (model.draftTrip === undefined) return;

        commit(
          ...saveTripDraftPatches(state, model.draftTrip),
          expoHelloWriters.appUi.update(MAIN_UI_ID, {
            activeRoute: 'home-screen',
            newTravelerName: '',
            selectedTripId: model.draftTrip.tripId,
            toast: 'Trip saved.',
          })
        );
      },
      sendMessage: () => {
        if (model.selectedTrip === undefined) return;

        const message = model.ui.draftMessage.trim() === '' ? 'No message entered.' : model.ui.draftMessage.trim();
        const nextStatus: ReceptionStatus = model.ui.requireConfirmation ? 'pending' : 'seen';
        const notificationTargets = model.selectedTrip.travelers.map((traveler) => traveler.name);

        commit(
        ...sendTripMessagePatches(
          model.selectedTrip,
          message,
          nextStatus,
          `${model.selectedTrip.id}-message-${model.ui.messageSeed}`,
          model.selectedTrip.messages.length + 1
        ),
        expoHelloWriters.appUi.update(MAIN_UI_ID, {
          activeRoute: 'current-message',
          messageSeed: model.ui.messageSeed + 1,
          toast:
            model.ui.sendPush && notificationTargets.length > 0
              ? `Push demo toast: notified ${notificationTargets.join(', ')}.`
              : '',
        })
      );
    },
      setDraftMessage: (draftMessage) => setUi({ draftMessage }),
      setNewTravelerName: (newTravelerName) => setUi({ newTravelerName }),
      setRequireConfirmation: (requireConfirmation) => setUi({ requireConfirmation }),
      setSendPush: (sendPush) => setUi({ sendPush }),
      setTripImageUri: (imageUri) => {
        if (model.draftTrip === undefined) return;
        commit(expoHelloWriters.tripDrafts.update(model.draftTrip.id, { imageUri }));
      },
      setTripName: (name) => {
        if (model.draftTrip === undefined) return;
        commit(expoHelloWriters.tripDrafts.update(model.draftTrip.id, { name }));
      },
      showToast: (toast) => setUi({ toast }),
    },
  };
}
