import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { LANGUAGE_OPTIONS } from '../../core/authService';
import { toApiError } from '../../core/http';
import { pushRegistrationStatus } from '../../core/pushRegistration';
import { User } from '../../core/types';
import { useServices } from '../services';
import { Button, Card, Chip, styles } from '../ui';

export function SettingsTab(props: { user: User; onUserChanged: (u: User) => void; onLogout: () => void }) {
  const { auth, store, mode, baseUrl, device } = useServices();
  const [langError, setLangError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [logoutWarning, setLogoutWarning] = useState<string | null>(null);

  const setLanguage = async (code: string) => {
    setBusy(true);
    setLangError(null);
    try {
      props.onUserChanged(await auth.updateLanguage(code));
    } catch (e) {
      const err = toApiError(e);
      setLangError(err.kind === 'network' ? 'Changing language needs a connection.' : err.message);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    const pending = (await store.listPendingWork(props.user.id)).length;
    if (pending > 0 && !logoutWarning) {
      setLogoutWarning(
        `${pending} report(s) have not finished syncing. They stay on this device and sync the next time ` +
          'you sign in with this account. Tap "Sign out" again to continue.',
      );
      return;
    }
    props.onLogout();
  };

  return (
    <ScrollView contentContainerStyle={styles.pad}>
      <Card>
        <Text style={styles.h2}>{props.user.full_name}</Text>
        <Text style={styles.muted}>
          {props.user.email} · {props.user.role}
          {props.user.is_demo_account ? ' · demo account' : ''}
        </Text>
      </Card>

      <Card>
        <Text style={styles.h2}>Alert language</Text>
        <Text style={styles.muted}>
          Alerts are delivered in this language. The app screens are in English for this prototype.
        </Text>
        {LANGUAGE_OPTIONS.map((o) => (
          <Chip
            key={o.code}
            label={o.label}
            selected={props.user.preferred_language === o.code}
            disabled={!o.enabled || busy}
            onPress={() => void setLanguage(o.code)}
          />
        ))}
        {langError && <Text style={styles.error}>{langError}</Text>}
      </Card>

      <Card>
        <Text style={styles.h2}>Connection</Text>
        <Text style={styles.body}>API mode: {mode === 'mock' ? 'MOCK (simulated data, no server)' : 'LIVE'}</Text>
        {mode === 'live' && <Text style={styles.body}>Server: {baseUrl}</Text>}
        <Text style={styles.body}>Push notifications: {pushRegistrationStatus()} (alerts arrive by inbox polling)</Text>
        <Text style={styles.muted}>
          App {device.app_version} · {device.platform}
        </Text>
      </Card>

      <Card>
        <Text style={styles.muted}>
          GeoRakshak is a decision-support tool. It is not an official warning authority. Always follow instructions
          from local authorities.
        </Text>
      </Card>

      {logoutWarning && <Text style={styles.error}>{logoutWarning}</Text>}
      <Button title="Sign out" kind="danger" onPress={() => void logout()} />
    </ScrollView>
  );
}
