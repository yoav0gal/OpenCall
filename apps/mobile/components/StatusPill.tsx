import { StyleSheet, Text, View } from 'react-native';

type StatusTone = 'good' | 'warn' | 'bad' | 'neutral';

type StatusPillProps = {
  label: string;
  tone: StatusTone;
};

export function StatusPill({ label, tone }: StatusPillProps) {
  return (
    <View style={[styles.pill, toneStyles[tone]]}>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  label: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 12,
  },
});

const toneStyles = StyleSheet.create({
  good: {
    backgroundColor: '#1f8f6a',
  },
  warn: {
    backgroundColor: '#b7791f',
  },
  bad: {
    backgroundColor: '#b24040',
  },
  neutral: {
    backgroundColor: '#506574',
  },
});
