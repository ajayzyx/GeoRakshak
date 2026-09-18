import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { toApiError } from '../../core/http';
import { AreaRisk, RISK_DISCLAIMER, RiskService } from '../../core/riskService';
import { formatAge } from '../../core/time';
import { getGpsFix } from '../adapters/deviceCapture';
import { Badge, Button, Card, colors, styles } from '../ui';

export function RiskTab(props: { riskService: RiskService }) {
  const [risk, setRisk] = useState<AreaRisk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void props.riskService.getCached().then(setRisk);
  }, [props.riskService]);

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      const fix = await getGpsFix();
      if (!fix.ok) {
        setError(fix.error);
        return;
      }
      setRisk(await props.riskService.refresh(fix.lat, fix.lon));
    } catch (e) {
      const err = toApiError(e);
      setError(err.kind === 'network' ? 'Offline: showing the last saved estimate.' : err.message);
    } finally {
      setBusy(false);
    }
  };

  const simulated = risk?.provenance === 'SIMULATED_DEMO';

  return (
    <ScrollView contentContainerStyle={styles.pad}>
      <Text style={styles.h1}>Risk at my location</Text>
      <Text style={[styles.body, { fontWeight: '700', color: colors.warn }]}>{RISK_DISCLAIMER}</Text>
      <Button title={busy ? 'Updating…' : 'Update for current location'} onPress={refresh} disabled={busy} />
      {error && <Text style={styles.error}>{error}</Text>}

      {risk ? (
        <Card>
          <View style={styles.row}>
            <Badge label={risk.severity ?? 'UNKNOWN'} color={colors.text} />
            {risk.confidence && <Badge label={`confidence ${risk.confidence}`} color={colors.muted} />}
            {risk.provenance && <Badge label={risk.provenance} color={simulated ? colors.mock : colors.muted} />}
            {risk.run_mode === 'DEMO_REPLAY' && <Badge label="DEMO REPLAY" color={colors.mock} />}
          </View>
          {risk.factors.length > 0 && (
            <View style={{ marginTop: 6 }}>
              <Text style={styles.label}>Main factors</Text>
              {risk.factors.map((f) => (
                <Text key={f} style={styles.body}>
                  • {f}
                </Text>
              ))}
            </View>
          )}
          <Text style={[styles.muted, { marginTop: 6 }]}>
            For {risk.lat.toFixed(4)}, {risk.lon.toFixed(4)} · last updated {formatAge(risk.fetched_at, new Date())}
            {risk.issue_time ? ` · issued ${new Date(risk.issue_time).toLocaleString()}` : ''}
            {risk.model_version ? ` · model ${risk.model_version}` : ''}
          </Text>
          {risk.server_disclaimer && risk.server_disclaimer !== RISK_DISCLAIMER && (
            <Text style={styles.muted}>{risk.server_disclaimer}</Text>
          )}
        </Card>
      ) : (
        <Text style={[styles.body, { marginTop: 8 }]}>No saved estimate yet. Update while online.</Text>
      )}
    </ScrollView>
  );
}
