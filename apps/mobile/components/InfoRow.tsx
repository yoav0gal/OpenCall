import { StyleSheet, Text, View } from 'react-native';

type InfoRowProps = {
  label: string;
  value: string;
  numberOfLines?: number;
};

export function InfoRow({ label, value, numberOfLines }: InfoRowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} numberOfLines={numberOfLines}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#5b6870',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  value: {
    fontSize: 15,
    color: '#243741',
  },
});
