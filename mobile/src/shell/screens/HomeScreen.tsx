import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, Text, View } from 'react-native';
import { INBOX_POLL_MS, SYNC_INTERVAL_MS } from '../../config';
import { modeForRole } from '../../core/authService';
import { toApiError } from '../../core/http';
import { InboxService, InboxSnapshot } from '../../core/inboxService';
import { RiskService } from '../../core/riskService';
import { ignoresBackoff, SyncScheduler, SyncTrigger } from '../../core/syncScheduler';
import { User } from '../../core/types';
import { subscribeConnectivity, subscribeForeground } from '../adapters/expoAdapters';
import { useServices } from '../services';
import { Button, colors, styles } from '../ui';
import { InboxTab } from './InboxTab';
import { ReportFormScreen } from './ReportFormScreen';
import { ReportsTab } from './ReportsTab';
import { RiskTab } from './RiskTab';
import { SettingsTab } from './SettingsTab';

type Tab = 'inbox' | 'reports' | 'risk' | 'settings';
type Route = { name: 'tabs' } | { name: 'reportForm'; alertId: string | null };

export function HomeScreen(props: {
  user: User;
  restoredOffline: boolean;
  authExpired: boolean;
  onUserChanged: (user: User) => void;
  onLogout: () => void;
}) {
  const services = useServices();
  const { user } = props;
  const mode = modeForRole(user.role);
  const [tab, setTab] = useState<Tab>('inbox');
  const [route, setRoute] = useState<Route>({ name: 'tabs' });
  const [online, setOnline] = useState<boolean | null>(null);
  const [inbox, setInbox] = useState<InboxSnapshot>({ items: [], updated_at: null });
  const [inboxError, setInboxError] = useState<string | null>(null);

  const inboxService = useMemo(
    () =>
      new InboxService({
        api: services.api,
        cache: services.kv,
        acks: services.acks,
        clock: services.clock,
        userId: user.id,
        role: user.role,
      }),
    [services, user.id, user.role],
  );
  const riskService = useMemo(
    () => new RiskService({ api: services.api, cache: services.kv, clock: services.clock, userId: user.id }),
    [services, user.id],
  );

  const refreshInbox = useCallback(async () => {
    try {
      setInbox(await inboxService.refresh());
      setInboxError(null);
    } catch (e) {
      setInbox(await inboxService.getCached());
      const err = toApiError(e);
      setInboxError(err.kind === 'network' ? 'Offline: showing saved alerts.' : err.message);
    }
  }, [inboxService]);

  // Queue sync + acknowledgement flush on every trigger (J4).
  const scheduler = useMemo(
    () =>
      new SyncScheduler({
        run: async (trigger: SyncTrigger) => {
          // Queue errors are recorded per item in the store; acknowledgements still get flushed.
          await services.engine
            .syncOnce({ force: ignoresBackoff(trigger) })
            .catch((e: unknown) => console.warn('Report sync failed', e));
          await inboxService.flushAcks();
        },
        subscribeConnectivity: (cb) =>
          subscribeConnectivity((isOnline) => {
            setOnline(isOnline);
            cb(isOnline);
          }),
        subscribeForeground,
        intervalMs: SYNC_INTERVAL_MS,
        setInterval: (fn, ms) => setInterval(fn, ms),
        clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
      }),
    [services, inboxService],
  );

  useEffect(() => {
    scheduler.start();
    return () => scheduler.stop();
  }, [scheduler]);

  // Inbox polling while the app is open (push not connected, H8).
  useEffect(() => {
    void inboxService.getCached().then(setInbox);
    void refreshInbox();
    const h = setInterval(() => void refreshInbox(), INBOX_POLL_MS);
    const unsub = subscribeForeground(() => void refreshInbox());
    return () => {
      clearInterval(h);
      unsub();
    };
  }, [inboxService, refreshInbox]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route.name === 'reportForm') {
        setRoute({ name: 'tabs' });
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [route]);

  if (route.name === 'reportForm') {
    return (
      <ReportFormScreen
        user={user}
        alertId={route.alertId}
        citizenMode={mode === 'CITIZEN'}
        onDone={(saved) => {
          setRoute({ name: 'tabs' });
          if (saved) {
            setTab('reports');
            void scheduler.syncNow();
          }
        }}
      />
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'inbox', label: mode === 'CITIZEN' ? 'Warnings' : 'Alerts' },
    { key: 'reports', label: mode === 'CITIZEN' ? 'My reports' : 'Reports' },
    { key: 'risk', label: 'Area risk' },
    { key: 'settings', label: 'Settings' },
  ];

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.card }}>
        <Text style={styles.h2}>
          {mode === 'CITIZEN' ? 'Citizen mode' : 'Field mode'} · {user.full_name}
        </Text>
        <Text style={[styles.muted, { color: online === false ? colors.danger : colors.muted }]}>
          {online === false ? 'Offline — reports are saved on this device and sync later' : 'Online'}
          {user.is_demo_account ? ' · demo account' : ''}
        </Text>
        {(props.authExpired || props.restoredOffline) && (
          <Text style={styles.error}>
            {props.authExpired
              ? 'Session expired. Sign in again to continue syncing. Saved reports are kept.'
              : 'Signed in from saved profile (server unreachable).'}
          </Text>
        )}
        {props.authExpired && <Button title="Sign in again" kind="secondary" onPress={props.onLogout} />}
      </View>

      <View style={{ flex: 1 }}>
        {tab === 'inbox' && (
          <InboxTab
            snapshot={inbox}
            error={inboxError}
            citizenMode={mode === 'CITIZEN'}
            onRefresh={refreshInbox}
            onAcknowledge={async (id) => {
              await inboxService.acknowledge(id);
              setInbox(await inboxService.getCached());
            }}
            onReportFromAlert={(alertId) => setRoute({ name: 'reportForm', alertId })}
          />
        )}
        {tab === 'reports' && (
          <ReportsTab
            user={user}
            citizenMode={mode === 'CITIZEN'}
            onNewReport={() => setRoute({ name: 'reportForm', alertId: null })}
            onSyncNow={() => scheduler.syncNow()}
          />
        )}
        {tab === 'risk' && <RiskTab riskService={riskService} />}
        {tab === 'settings' && (
          <SettingsTab user={user} onUserChanged={props.onUserChanged} onLogout={props.onLogout} />
        )}
      </View>

      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
        {tabs.map((t) => (
          <Pressable
            key={t.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.key }}
            onPress={() => setTab(t.key)}
            style={{ flex: 1, paddingVertical: 12, alignItems: 'center' }}
          >
            <Text style={{ color: tab === t.key ? colors.primary : colors.muted, fontWeight: tab === t.key ? '700' : '400' }}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
