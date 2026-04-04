import { StyleSheet, Text, View } from 'react-native';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type EventLogEntry = {
  id: string;
  level: LogLevel;
  message: string;
};

type EventLogProps = {
  entries: EventLogEntry[];
};

export function EventLog({ entries }: EventLogProps) {
  if (entries.length === 0) {
    return <Text style={styles.muted}>No events yet.</Text>;
  }

  return (
    <>
      {entries.map((entry) => (
        <View key={entry.id} style={styles.row}>
          <Text style={[styles.level, levelStyles[entry.level]]}>{entry.level.toUpperCase()}</Text>
          <Text style={styles.message}>{entry.message}</Text>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  muted: {
    color: '#69757d',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  level: {
    fontSize: 11,
    fontWeight: '800',
    width: 46,
    marginTop: 2,
  },
  message: {
    fontSize: 13,
    color: '#334155',
    flex: 1,
    lineHeight: 18,
  },
});

const levelStyles = StyleSheet.create({
  debug: {
    color: '#43525e',
  },
  info: {
    color: '#1f8f6a',
  },
  warn: {
    color: '#b7791f',
  },
  error: {
    color: '#b24040',
  },
});
