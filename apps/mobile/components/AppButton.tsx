import { Pressable, StyleSheet, Text } from 'react-native';

type ButtonTone = 'primary' | 'secondary' | 'neutral' | 'danger';

type AppButtonProps = {
  label: string;
  onPress: () => void;
  tone?: ButtonTone;
  fullWidth?: boolean;
};

export function AppButton({
  label,
  onPress,
  tone = 'neutral',
  fullWidth = true,
}: AppButtonProps) {
  return (
    <Pressable style={[styles.button, fullWidth ? styles.fullWidth : null, toneStyles[tone]]} onPress={onPress}>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
  },
  fullWidth: {
    flex: 1,
  },
  label: {
    color: '#fff',
    fontWeight: '700',
  },
});

const toneStyles = StyleSheet.create({
  primary: {
    backgroundColor: '#bf5b39',
  },
  secondary: {
    backgroundColor: '#637081',
  },
  neutral: {
    backgroundColor: '#27485a',
  },
  danger: {
    backgroundColor: '#9f2f2f',
  },
});
