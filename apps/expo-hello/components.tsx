import { Pressable, Text, View } from 'react-native';
import type { AppRouteId } from './routes';
import { styles } from './styles';

type NavigateButtonProps = {
  readonly label: string;
  readonly route: AppRouteId;
  readonly onNavigate: (route: AppRouteId) => void;
};

export function NavigateButton({ label, route, onNavigate }: NavigateButtonProps) {
  return (
    <Pressable accessibilityRole="button" onPress={() => onNavigate(route)} style={styles.button}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

type ToastProps = {
  readonly message: string;
  readonly onDismiss: () => void;
};

export function Toast({ message, onDismiss }: ToastProps) {
  if (message === '') return null;

  return (
    <View accessibilityRole="alert" style={styles.toast}>
      <Text>{message}</Text>
      <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.button}>
        <Text style={styles.buttonText}>Dismiss</Text>
      </Pressable>
    </View>
  );
}

type OptionRowProps = {
  readonly checked: boolean;
  readonly description: string;
  readonly label: string;
  readonly onPress: () => void;
};

export function OptionRow({ checked, description, label, onPress }: OptionRowProps) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={onPress} style={styles.listItem}>
      <Text style={styles.bold}>{checked ? '[x]' : '[ ]'} {label}</Text>
      <Text style={styles.muted}>{description}</Text>
    </Pressable>
  );
}
