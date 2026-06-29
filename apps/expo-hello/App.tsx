import { StatusBar } from 'expo-status-bar';
import { createElement, useRef, type ChangeEvent } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { useExpoHelloState } from './app-state';
import { Toast } from './components';
import { routeTitle } from './presentation';
import { CurrentMessageScreen, HomeScreen, MessageScreen, TripEditorScreen } from './screens';
import { styles } from './styles';

export default function App() {
  const { actions, draftTrip, selectedTrip, trips, ui } = useExpoHelloState();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const openImagePicker = () => {
    if (Platform.OS === 'web') {
      fileInputRef.current?.click();
      return;
    }

    actions.showToast('Image picker demo is wired through the hidden web file input.');
  };

  const onImagePicked = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];

    if (file === undefined || draftTrip === undefined) return;

    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result !== 'string') return;
      actions.setTripImageUri(reader.result);
      actions.showToast('Trip image stored in Tarstate state.');
    });
    reader.readAsDataURL(file);
    input.value = '';
  };

  const hiddenImageInput =
    Platform.OS === 'web'
      ? createElement('input', {
          accept: 'image/*',
          id: 'trip-image-picker',
          name: 'trip-image-picker',
          onChange: onImagePicked,
          ref: fileInputRef,
          style: { display: 'none' },
          type: 'file',
        })
      : null;

  return (
    <View style={styles.screen}>
      <StatusBar style="auto" />
      {hiddenImageInput}
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{routeTitle(ui.activeRoute)}</Text>

        {ui.activeRoute === 'home-screen' ? (
          <HomeScreen trips={trips} onAddTrip={actions.addTrip} onOpenTrip={actions.openTrip} />
        ) : null}
        {ui.activeRoute === 'message' ? (
          <MessageScreen
            selectedTrip={selectedTrip}
            ui={ui}
            onChangeDraftMessage={actions.setDraftMessage}
            onSendMessage={actions.sendMessage}
            onSetRequireConfirmation={actions.setRequireConfirmation}
            onSetSendPush={actions.setSendPush}
          />
        ) : null}
        {ui.activeRoute === 'add-or-edit-trip' ? (
          <TripEditorScreen
            draftTrip={draftTrip}
            ui={ui}
            onAddTraveler={actions.addTraveler}
            onCancel={actions.cancelTripEdit}
            onChangeName={actions.setTripName}
            onChangeNewTravelerName={actions.setNewTravelerName}
            onDeleteTraveler={actions.deleteTraveler}
            onOpenImagePicker={openImagePicker}
            onSave={actions.saveTripEdit}
          />
        ) : null}
        {ui.activeRoute === 'current-message' ? (
          <CurrentMessageScreen
            selectedTrip={selectedTrip}
            onNavigate={actions.navigate}
            onNudgeUnconfirmed={actions.nudgeUnconfirmed}
          />
        ) : null}
      </ScrollView>
      <Toast message={ui.toast} onDismiss={actions.dismissToast} />
    </View>
  );
}
