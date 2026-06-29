import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { NavigateButton, OptionRow } from './components';
import { MESSAGE_LIMIT, initials, memberText, statusIcon, statusLabel } from './presentation';
import type { AppRouteId } from './routes';
import { styles } from './styles';
import type { AppUiRow, ReceptionStatus, TripDraftView, TripView } from './trips';

type HomeScreenProps = {
  readonly trips: readonly TripView[];
  readonly onAddTrip: () => void;
  readonly onOpenTrip: (tripId: string) => void;
};

export function HomeScreen({ trips, onAddTrip, onOpenTrip }: HomeScreenProps) {
  return (
    <View style={styles.section}>
      <View style={styles.row}>
        <Text style={styles.heading}>Home Screen</Text>
        <Pressable accessibilityLabel="Add trip" accessibilityRole="button" onPress={onAddTrip} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>+</Text>
        </Pressable>
      </View>

      {trips.map((trip) => (
        <Pressable accessibilityRole="button" key={trip.id} onPress={() => onOpenTrip(trip.id)} style={styles.tripListItem}>
          <View style={styles.tripThumbnail}>
            {trip.imageUri === '' ? (
              <Text style={styles.tripThumbnailText}>{trip.icon}</Text>
            ) : (
              <>
                <Image source={{ uri: trip.imageUri }} style={styles.tripThumbnailImage} />
                <Text style={styles.tripThumbnailOverlayText}>{trip.icon}</Text>
              </>
            )}
          </View>
          <View style={styles.tripText}>
            <Text style={styles.bold}>{trip.name}</Text>
            <Text>{memberText(trip.travelers.length)}</Text>
            <Text style={styles.muted}>{trip.latestMessage}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

type MessageScreenProps = {
  readonly selectedTrip: TripView | undefined;
  readonly ui: AppUiRow;
  readonly onChangeDraftMessage: (message: string) => void;
  readonly onSendMessage: () => void;
  readonly onSetRequireConfirmation: (value: boolean) => void;
  readonly onSetSendPush: (value: boolean) => void;
};

export function MessageScreen({
  selectedTrip,
  ui,
  onChangeDraftMessage,
  onSendMessage,
  onSetRequireConfirmation,
  onSetSendPush,
}: MessageScreenProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Message</Text>
      <Text style={styles.muted}>{selectedTrip === undefined ? 'Select a trip to message.' : selectedTrip.name}</Text>
      <TextInput
        accessibilityLabel="New message text"
        maxLength={MESSAGE_LIMIT}
        multiline
        nativeID="new-message-text"
        onChangeText={onChangeDraftMessage}
        style={styles.textArea}
        value={ui.draftMessage}
      />
      <Text style={styles.muted}>{ui.draftMessage.length}/{MESSAGE_LIMIT}</Text>

      <Text style={styles.subheading}>Options</Text>
      <OptionRow
        checked={ui.requireConfirmation}
        description="Members must tap to confirm."
        label="Require confirmation"
        onPress={() => onSetRequireConfirmation(!ui.requireConfirmation)}
      />
      <OptionRow
        checked={ui.sendPush}
        description="Notify members instantly."
        label="Send push notifications"
        onPress={() => onSetSendPush(!ui.sendPush)}
      />

      <Pressable accessibilityRole="button" onPress={onSendMessage} style={styles.primaryButton}>
        <Text style={styles.primaryButtonText}>Send Message</Text>
      </Pressable>
    </View>
  );
}

type TripEditorProps = {
  readonly draftTrip: TripDraftView | undefined;
  readonly ui: AppUiRow;
  readonly onAddTraveler: () => void;
  readonly onCancel: () => void;
  readonly onChangeName: (name: string) => void;
  readonly onChangeNewTravelerName: (name: string) => void;
  readonly onDeleteTraveler: (travelerId: string) => void;
  readonly onOpenImagePicker: () => void;
  readonly onSave: () => void;
};

export function TripEditorScreen({
  draftTrip,
  ui,
  onAddTraveler,
  onCancel,
  onChangeName,
  onChangeNewTravelerName,
  onDeleteTraveler,
  onOpenImagePicker,
  onSave,
}: TripEditorProps) {
  if (draftTrip === undefined) {
    return (
      <View style={styles.section}>
        <Text style={styles.heading}>Add or Edit Trip</Text>
        <Text>No trip draft is active.</Text>
        <Pressable accessibilityRole="button" onPress={onCancel} style={styles.button}>
          <Text style={styles.buttonText}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Add or Edit Trip</Text>
      <Pressable accessibilityLabel="Choose trip image" accessibilityRole="button" onPress={onOpenImagePicker}>
        {draftTrip.imageUri === '' ? (
          <View style={styles.imagePlaceholder}>
            <Text style={styles.bold}>Trip image</Text>
            <Text style={styles.muted}>No image selected</Text>
          </View>
        ) : (
          <Image source={{ uri: draftTrip.imageUri }} style={styles.image} />
        )}
        <Text style={styles.muted}>Tap image to choose a file</Text>
      </Pressable>

      <Text style={styles.bold}>Trip name</Text>
      <TextInput
        accessibilityLabel="Trip name"
        nativeID="trip-name"
        onChangeText={onChangeName}
        style={styles.input}
        value={draftTrip.name}
      />

      <Text style={styles.subheading}>Travelers</Text>
      {draftTrip.travelers.map((traveler) => (
        <View key={traveler.id} style={styles.row}>
          <Text>{initials(traveler.name)} {traveler.name}</Text>
          <Pressable accessibilityRole="button" onPress={() => onDeleteTraveler(traveler.id)} style={styles.button}>
            <Text style={styles.buttonText}>Delete</Text>
          </Pressable>
        </View>
      ))}

      <View style={styles.row}>
        <TextInput
          accessibilityLabel="New traveler name"
          nativeID="new-traveler-name"
          onChangeText={onChangeNewTravelerName}
          placeholder="Traveler name"
          style={styles.input}
          value={ui.newTravelerName}
        />
        <Pressable accessibilityRole="button" onPress={onAddTraveler} style={styles.button}>
          <Text style={styles.buttonText}>Add traveler</Text>
        </Pressable>
      </View>

      <View style={styles.row}>
        <Pressable accessibilityRole="button" onPress={onSave} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Save Trip</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onCancel} style={styles.button}>
          <Text style={styles.buttonText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

type CurrentMessageProps = {
  readonly selectedTrip: TripView | undefined;
  readonly onNavigate: (route: AppRouteId) => void;
  readonly onNudgeUnconfirmed: () => void;
};

export function CurrentMessageScreen({
  selectedTrip,
  onNavigate,
  onNudgeUnconfirmed,
}: CurrentMessageProps) {
  const travelers = selectedTrip?.travelers ?? [];
  const statusGroups: readonly ReceptionStatus[] = ['confirmed', 'seen', 'pending'];

  return (
    <View style={styles.section}>
      <Pressable accessibilityRole="button" onPress={() => onNavigate('home-screen')} style={styles.button}>
        <Text style={styles.buttonText}>Back to Trips</Text>
      </Pressable>
      <Text style={styles.tripTitle}>{selectedTrip === undefined ? 'Current Message' : selectedTrip.name}</Text>
      <View style={styles.messageBox}>
        <Text>{selectedTrip?.latestMessage ?? 'Select a trip to view message status.'}</Text>
      </View>

      <Text style={styles.subheading}>Status Summary</Text>
      <View style={styles.statusSummary}>
        {statusGroups.map((status) => (
          <View key={status} style={styles.statusBox}>
            <Text style={styles.statusIcon}>{statusIcon(status)}</Text>
            <Text style={styles.bold}>{travelers.filter((traveler) => traveler.receiptStatus === status).length}</Text>
            <Text style={styles.muted}>{statusLabel(status)}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.subheading}>Messages</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator style={styles.messageScroller}>
        {(selectedTrip?.messages ?? []).map((message) => (
          <View key={message.id} style={styles.messageCard}>
            <Text style={styles.muted}>#{message.sequence}</Text>
            <Text>{message.text}</Text>
          </View>
        ))}
      </ScrollView>

      <Text style={styles.subheading}>Travelers</Text>
      <View style={styles.avatarGrid}>
        {travelers.map((traveler) => (
          <View key={traveler.id} style={styles.avatarCard}>
            <Text style={styles.avatarInitials}>{initials(traveler.name)}</Text>
            <Text style={styles.bold}>{traveler.name}</Text>
            <Text>{statusIcon(traveler.receiptStatus)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.row}>
        <NavigateButton label="Send New Message" route="message" onNavigate={onNavigate} />
        <Pressable accessibilityRole="button" onPress={onNudgeUnconfirmed} style={styles.button}>
          <Text style={styles.buttonText}>Nudge Unconfirmed</Text>
        </Pressable>
      </View>
    </View>
  );
}
