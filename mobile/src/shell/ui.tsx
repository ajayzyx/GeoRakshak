import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';

export const colors = {
  bg: '#f5f6f4',
  card: '#ffffff',
  text: '#1c2321',
  muted: '#5b6663',
  border: '#d9dedb',
  primary: '#1f5f4a',
  danger: '#a3262a',
  warn: '#8a5a00',
  mock: '#6b2fa3',
  ok: '#2c6e2f',
};

export function MockBanner() {
  return (
    <View style={styles.mockBanner} accessibilityRole="alert">
      <Text style={styles.mockText}>MOCK DATA · SIMULATED_DEMO · not connected to a server</Text>
    </View>
  );
}

export function Button(props: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const kind = props.kind ?? 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        kind === 'primary' && { backgroundColor: colors.primary },
        kind === 'secondary' && { backgroundColor: colors.card, borderColor: colors.primary, borderWidth: 1 },
        kind === 'danger' && { backgroundColor: colors.danger },
        (props.disabled || pressed) && { opacity: 0.6 },
        props.style,
      ]}
    >
      <Text style={[styles.buttonText, kind === 'secondary' && { color: colors.primary }]}>{props.title}</Text>
    </Pressable>
  );
}

export function Chip(props: { label: string; selected: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: props.selected, disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={[styles.chip, props.selected && styles.chipSelected, props.disabled && { opacity: 0.4 }]}
    >
      <Text style={[styles.chipText, props.selected && { color: '#fff' }]}>{props.label}</Text>
    </Pressable>
  );
}

export function Card(props: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, props.style]}>{props.children}</View>;
}

export function Badge(props: { label: string; color: string }) {
  return (
    <View style={[styles.badge, { borderColor: props.color }]}>
      <Text style={[styles.badgeText, { color: props.color }]}>{props.label}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  mockBanner: { backgroundColor: colors.mock, paddingVertical: 4, alignItems: 'center' },
  mockText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  button: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center', marginVertical: 4 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.primary,
    marginRight: 6,
    marginBottom: 6,
  },
  chipSelected: { backgroundColor: colors.primary },
  chipText: { color: colors.primary, fontSize: 13 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1, marginRight: 6 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  h1: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: 8 },
  h2: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted, marginTop: 12, marginBottom: 4 },
  body: { fontSize: 14, color: colors.text },
  muted: { fontSize: 12, color: colors.muted },
  error: { fontSize: 13, color: colors.danger, marginVertical: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    padding: 10,
    backgroundColor: '#fff',
    fontSize: 15,
    color: colors.text,
  },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { padding: 16 },
});
