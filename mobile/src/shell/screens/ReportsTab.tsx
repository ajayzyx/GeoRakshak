import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Text, View } from 'react-native';
import { CATEGORY_LABELS } from '../../core/categories';
import { canDiscard, displaySyncStatus, mediaStatusLabel } from '../../core/syncEngine';
import { LocalMedia, LocalReport, User } from '../../core/types';
import { discardLocalFile } from '../adapters/deviceCapture';
import { useServices } from '../services';
import { Badge, Button, Card, colors, styles } from '../ui';
import { CITIZEN_MODERATION_NOTE } from './ReportFormScreen';

const statusColor: Record<string, string> = {
  Queued: colors.warn,
  Syncing: colors.primary,
  'Media uploading': colors.primary,
  Synced: colors.ok,
  Failed: colors.danger,
};

type Row = { report: LocalReport; media: LocalMedia[] };

export function ReportsTab(props: {
  user: User;
  citizenMode: boolean;
  onNewReport: () => void;
  onSyncNow: () => Promise<void>;
}) {
  const { store, engine } = useServices();
  const [rows, setRows] = useState<Row[]>([]);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const reports = await store.listReports(props.user.id);
    setRows(await Promise.all(reports.map(async (r) => ({ report: r, media: await store.listMedia(r.client_report_id) }))));
  }, [store, props.user.id]);

  useEffect(() => {
    void load();
    return engine.subscribe(() => void load());
  }, [engine, load]);

  const syncNow = async () => {
    setSyncing(true);
    try {
      await props.onSyncNow();
    } finally {
      setSyncing(false);
      void load();
    }
  };

  const confirmDiscard = ({ report, media }: Row) => {
    Alert.alert(
      'Discard this report?',
      `It has not been sent. The report and its ${media.length} photo(s)/video(s) will be deleted from this ` +
        'device. This cannot be undone.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: async () => {
            const uris = await store.discardUnsynced(report.client_report_id);
            if (uris === null) {
              Alert.alert('Not discarded', 'The report is being sent or has already reached the server.');
            } else {
              uris.forEach(discardLocalFile);
            }
            await load();
          },
        },
      ],
    );
  };

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    const label = displaySyncStatus(r.report, r.media).label;
    acc[label] = (acc[label] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <FlatList
      contentContainerStyle={styles.pad}
      data={rows}
      keyExtractor={(r) => r.report.client_report_id}
      ListHeaderComponent={
        <View style={{ marginBottom: 8 }}>
          <Button title="New report" onPress={props.onNewReport} />
          <Button title={syncing ? 'Syncing…' : 'Sync now'} kind="secondary" disabled={syncing} onPress={() => void syncNow()} />
          <Text style={styles.muted}>
            {Object.entries(counts)
              .map(([label, n]) => `${label}: ${n}`)
              .join(' · ') || 'Reports are saved on this device first.'}
          </Text>
          <Text style={styles.muted}>Report details are sent before photos and videos.</Text>
          {props.citizenMode && <Text style={[styles.muted, { color: colors.warn }]}>{CITIZEN_MODERATION_NOTE}</Text>}
        </View>
      }
      ListEmptyComponent={<Text style={styles.body}>No reports yet.</Text>}
      renderItem={({ item }) => {
        const { report, media } = item;
        const status = displaySyncStatus(report, media);
        const retryable = report.status === 'FAILED' || media.some((m) => m.upload_status === 'FAILED');
        const [lon, lat] = report.location.coordinates;
        return (
          <Card>
            <View style={styles.row}>
              <Badge label={status.label} color={statusColor[status.label] ?? colors.text} />
              <Badge label={CATEGORY_LABELS[report.category]} color={colors.text} />
              <Badge label={report.severity} color={colors.text} />
            </View>
            <Text style={[styles.body, { marginTop: 6 }]} numberOfLines={3}>
              {report.description}
            </Text>
            <Text style={styles.muted}>
              Captured {new Date(report.captured_at).toLocaleString()}
              {report.alert_id ? ' · linked to an alert' : ''}
            </Text>
            <Text style={styles.muted}>
              {lat.toFixed(5)}, {lon.toFixed(5)} ±{Math.round(report.gps_accuracy_m ?? 0)} m
              {report.location_adjusted_manually ? ' · pin set by hand' : ' · GPS'}
            </Text>
            {media.map((m, i) => (
              <Text
                key={m.client_media_id}
                style={[styles.muted, m.upload_status === 'FAILED' && { color: colors.danger }]}
              >
                {m.media_type === 'PHOTO' ? 'Photo' : 'Video'} {i + 1} · {(m.size_bytes / 1_000_000).toFixed(1)} MB ·{' '}
                {mediaStatusLabel(report, m)}
                {m.last_error && m.upload_status !== 'UPLOADED' ? ` · ${m.last_error}` : ''}
              </Text>
            ))}
            {status.detail && (
              <Text style={status.label === 'Failed' ? styles.error : styles.muted}>{status.detail}</Text>
            )}
            {status.label === 'Synced' && props.citizenMode && (
              <Text style={styles.muted}>Received by the server. Awaiting review by the authorities.</Text>
            )}
            <View style={styles.row}>
              {retryable && (
                <Button
                  title="Retry"
                  kind="secondary"
                  style={{ marginRight: 8 }}
                  onPress={async () => {
                    await store.retryFailed(report.client_report_id);
                    await load();
                    void syncNow();
                  }}
                />
              )}
              {canDiscard(report) && (
                <Button title="Discard" kind="danger" onPress={() => confirmDiscard(item)} />
              )}
            </View>
          </Card>
        );
      }}
    />
  );
}
