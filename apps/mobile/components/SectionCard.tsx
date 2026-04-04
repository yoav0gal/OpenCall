import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

type SectionCardProps = {
  title: string;
  lead?: string;
  children: ReactNode;
};

export function SectionCard({ title, lead, children }: SectionCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {lead ? <Text style={styles.lead}>{lead}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#f7f3ea',
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: '#d5d0c4',
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1a2d38',
  },
  lead: {
    fontSize: 14,
    color: '#5b6870',
    lineHeight: 20,
  },
});
