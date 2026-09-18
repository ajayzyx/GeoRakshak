import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, Text, TextInput } from 'react-native';
import { toApiError } from '../../core/http';
import { User } from '../../core/types';
import { MOCK_USERS } from '../../mock/fixtures_simulated';
import { useServices } from '../services';
import { Button, styles } from '../ui';

export function LoginScreen(props: { onLoggedIn: (user: User) => void }) {
  const { auth, mode, baseUrl } = useServices();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      props.onLoggedIn(await auth.login(email, password));
    } catch (e) {
      const err = toApiError(e);
      setError(
        err.kind === 'network'
          ? `Cannot reach the server at ${baseUrl}. Sign-in needs a connection once; after that the app works offline.`
          : err.message,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        <Text style={styles.h1}>GeoRakshak</Text>
        <Text style={styles.muted}>
          Landslide risk decision support. Not an official warning authority. Follow instructions from local
          authorities.
        </Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <Text style={styles.label}>Password</Text>
        <TextInput style={styles.input} secureTextEntry value={password} onChangeText={setPassword} />
        {error && <Text style={styles.error}>{error}</Text>}
        <Button title={busy ? 'Signing in…' : 'Sign in'} onPress={submit} disabled={busy || !email || !password} />

        {mode === 'mock' ? (
          <>
            <Text style={styles.label}>Mock accounts (any non-empty password)</Text>
            {MOCK_USERS.map((u) => (
              <Button
                key={u.id}
                kind="secondary"
                title={`${u.full_name} (${u.role})`}
                onPress={() => {
                  setEmail(u.email);
                  setPassword('mock');
                }}
              />
            ))}
          </>
        ) : (
          <Text style={[styles.muted, { marginTop: 12 }]}>Server: {baseUrl}</Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
