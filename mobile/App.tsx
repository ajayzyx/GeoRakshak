import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StatusBar as RNStatusBar, Text, View } from 'react-native';
import { API_MODE } from './src/config';
import { modeForRole } from './src/core/authService';
import { User } from './src/core/types';
import { HomeScreen } from './src/shell/screens/HomeScreen';
import { LoginScreen } from './src/shell/screens/LoginScreen';
import { AppServices, ServicesContext, createAppServices } from './src/shell/services';
import { Button, MockBanner, colors, styles } from './src/shell/ui';

/**
 * Navigation is a small state machine (login → home tabs → report form) rather
 * than expo-router or react-navigation: four screens, no deep links, and one
 * fewer dependency tree to keep compatible with Expo Go.
 */
export default function App() {
  const [services, setServices] = useState<AppServices | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [session, setSession] = useState<{ user: User; offline: boolean } | null>(null);
  const [authExpired, setAuthExpired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await createAppServices(() => setAuthExpired(true));
        const restored = await s.auth.restore();
        if (cancelled) return;
        setServices(s);
        setSession(restored);
      } catch (e) {
        if (!cancelled) setBootError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async () => {
    await services?.auth.logout();
    setAuthExpired(false);
    setSession(null);
  }, [services]);

  const topPad = Platform.OS === 'android' ? (RNStatusBar.currentHeight ?? 0) : 44;

  let content;
  if (bootError) {
    content = (
      <View style={styles.pad}>
        <Text style={styles.h1}>Could not start</Text>
        <Text style={styles.error}>{bootError}</Text>
      </View>
    );
  } else if (!services) {
    content = <ActivityIndicator style={{ marginTop: 48 }} color={colors.primary} />;
  } else if (!session) {
    content = (
      <LoginScreen
        onLoggedIn={(user) => {
          setAuthExpired(false);
          setSession({ user, offline: false });
        }}
      />
    );
  } else if (modeForRole(session.user.role) === 'UNSUPPORTED') {
    content = (
      <View style={styles.pad}>
        <Text style={styles.h1}>Use the web dashboard</Text>
        <Text style={styles.body}>
          The mobile app supports field officer and citizen accounts. Your role ({session.user.role}) uses the web
          dashboard.
        </Text>
        <Button title="Sign out" onPress={logout} kind="secondary" />
      </View>
    );
  } else {
    content = (
      <HomeScreen
        user={session.user}
        restoredOffline={session.offline}
        authExpired={authExpired}
        onUserChanged={(user) => setSession({ user, offline: false })}
        onLogout={logout}
      />
    );
  }

  return (
    <ServicesContext.Provider value={services}>
      <View style={[styles.screen, { paddingTop: topPad }]}>
        <StatusBar style="dark" />
        {API_MODE === 'mock' && <MockBanner />}
        {content}
      </View>
    </ServicesContext.Provider>
  );
}
