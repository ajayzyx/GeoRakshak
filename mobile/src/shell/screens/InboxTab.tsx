import { useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { InboxEntry, InboxSnapshot } from '../../core/inboxService';
import { formatAge } from '../../core/time';
import { Badge, Button, Card, colors, styles } from '../ui';

const tierLabel: Record<InboxEntry['tier'], string> = {
  WATCH: 'INTERNAL WATCH',
  WARNING: 'PUBLIC WARNING',
  UPDATE: 'UPDATE',
};

export function InboxTab(props: {
  snapshot: InboxSnapshot;
  error: string | null;
  citizenMode: boolean;
  onRefresh: () => Promise<void>;
  onAcknowledge: (alertId: string) => Promise<void>;
  onReportFromAlert: (alertId: string) => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const now = new Date();

  return (
    <FlatList
      contentContainerStyle={styles.pad}
      data={props.snapshot.items}
      keyExtractor={(i) => i.alert_id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await props.onRefresh();
            setRefreshing(false);
          }}
        />
      }
      ListHeaderComponent={
        <View style={{ marginBottom: 8 }}>
          <Text style={styles.muted}>Last updated: {formatAge(props.snapshot.updated_at, now)}</Text>
          {props.error && <Text style={styles.error}>{props.error}</Text>}
          <Text style={styles.muted}>
            GeoRakshak is decision support, not an official warning authority. Follow instructions from local
            authorities.
          </Text>
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.body}>{props.citizenMode ? 'No warnings for your area.' : 'No alerts.'}</Text>
      }
      renderItem={({ item }) => (
        <Card>
          <View style={styles.row}>
            <Badge label={tierLabel[item.tier]} color={item.tier === 'WARNING' ? colors.danger : colors.warn} />
            <Badge label={item.severity} color={colors.text} />
            {item.is_demo && <Badge label="DEMO" color={colors.mock} />}
          </View>
          <Text style={[styles.h2, { marginTop: 6 }]}>{item.title}</Text>
          <Text style={styles.body}>{item.body}</Text>
          <Text style={[styles.muted, { marginTop: 4 }]}>
            Dispatched {item.dispatched_at ? new Date(item.dispatched_at).toLocaleString() : 'time unknown'}
            {item.lead_time_h ? ` · forecast +${item.lead_time_h} h` : ''}
          </Text>
          {item.acknowledged_at ? (
            <Text style={[styles.muted, { color: colors.ok }]}>
              Acknowledged {new Date(item.acknowledged_at).toLocaleString()}
              {item.ack_pending ? ' · waiting for connection to send' : ''}
            </Text>
          ) : (
            <Button
              title={busyId === item.alert_id ? 'Acknowledging…' : 'Acknowledge'}
              disabled={busyId !== null}
              onPress={async () => {
                setBusyId(item.alert_id);
                try {
                  await props.onAcknowledge(item.alert_id);
                } finally {
                  setBusyId(null);
                }
              }}
            />
          )}
          {item.ack_error && <Text style={styles.error}>{item.ack_error}</Text>}
          <Button title="Report from this alert" kind="secondary" onPress={() => props.onReportFromAlert(item.alert_id)} />
        </Card>
      )}
    />
  );
}
