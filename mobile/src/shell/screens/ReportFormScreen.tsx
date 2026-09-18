import { useEffect, useMemo, useReducer, useRef } from 'react';
import { Alert, Image, KeyboardAvoidingView, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { accuracyAdvice, accuracyQuality } from '../../core/capture';
import { CATEGORY_HINTS, CATEGORY_LABELS, CATEGORY_VOCABULARY_NOTE } from '../../core/categories';
import { MAX_MEDIA_PER_REPORT, VIDEO_CAPTURE_MAX_S } from '../../core/media';
import { DraftField } from '../../core/reportDraft';
import {
  formIssues,
  hasContent,
  initialFormState,
  issuesFor,
  mediaCounts,
  reportFormReducer,
} from '../../core/reportForm';
import { queueReport } from '../../core/reportDraft';
import { MediaType, REPORT_CATEGORIES, REPORT_SEVERITIES, User } from '../../core/types';
import { captureMedia, discardLocalFile, getGpsFix } from '../adapters/deviceCapture';
import { newUuid } from '../adapters/expoAdapters';
import { useServices } from '../services';
import { Button, Card, Chip, colors, styles } from '../ui';

export const CITIZEN_MODERATION_NOTE =
  'Moderation required: every citizen report is reviewed by the authorities before it is used. ' +
  'Sending a report is not an emergency call.';

export function ReportFormScreen(props: {
  user: User;
  alertId: string | null;
  citizenMode: boolean;
  onDone: (saved: boolean) => void;
}) {
  const { store, clock } = useServices();
  const [state, dispatch] = useReducer(reportFormReducer, props.alertId, initialFormState);
  const issues = useMemo(() => formIssues(state), [state]);
  const saving = useRef(false); // synchronous guard: a fast double tap must not save twice
  const { draft } = state;

  const locate = async () => {
    dispatch({ type: 'locating' });
    dispatch({ type: 'gpsResult', fix: await getGpsFix() });
  };

  useEffect(() => {
    void locate();
  }, []);

  const addMedia = async (kind: MediaType) => {
    if (mediaCounts(state).atLimit) {
      dispatch({ type: 'mediaError', error: `At most ${MAX_MEDIA_PER_REPORT} photos/videos per report.` });
      return;
    }
    dispatch({ type: 'mediaError', error: null });
    dispatch({ type: 'busy', busy: 'capturing' });
    try {
      const res = await captureMedia(kind);
      if ('cancelled' in res) return;
      if (!res.ok) {
        dispatch({ type: 'mediaError', error: res.error });
        return;
      }
      dispatch({ type: 'mediaAdded', media: res.media });
    } finally {
      dispatch({ type: 'busy', busy: 'idle' });
    }
  };

  const removeMedia = (uri: string) => {
    discardLocalFile(uri);
    dispatch({ type: 'mediaRemoved', uri });
  };

  const cancel = () => {
    const leave = () => {
      for (const m of draft.media) discardLocalFile(m.local_uri);
      props.onDone(false);
    };
    if (!hasContent(state)) {
      leave();
      return;
    }
    Alert.alert('Discard this draft?', 'The draft and any photos or videos you took for it will be deleted.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: leave },
    ]);
  };

  const save = async () => {
    dispatch({ type: 'attemptSave' });
    if (issues.length || saving.current) return;
    saving.current = true;
    dispatch({ type: 'busy', busy: 'saving' });
    try {
      const res = await queueReport(draft, {
        store,
        clock,
        newId: newUuid,
        language: props.user.preferred_language,
        ownerUserId: props.user.id,
      });
      if (res.ok) {
        props.onDone(true);
        return;
      }
    } catch (e) {
      dispatch({ type: 'saveError', error: `Could not save on this device: ${e instanceof Error ? e.message : String(e)}` });
    }
    saving.current = false;
    dispatch({ type: 'busy', busy: 'idle' });
  };

  const Issues = ({ field }: { field: DraftField }) =>
    state.showIssues ? (
      <>
        {issuesFor(issues, field).map((m) => (
          <Text key={m} style={styles.error}>
            {m}
          </Text>
        ))}
      </>
    ) : null;

  const counts = mediaCounts(state);
  const advice = draft.location_adjusted_manually ? null : accuracyAdvice(draft.gps_accuracy_m);
  const quality = accuracyQuality(draft.gps_accuracy_m);
  const busy = state.busy;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        <Text style={styles.h1}>{props.citizenMode ? 'Report an observation' : 'New field report'}</Text>
        {props.citizenMode && (
          <Card style={{ borderColor: colors.warn }}>
            <Text style={styles.body}>{CITIZEN_MODERATION_NOTE}</Text>
          </Card>
        )}
        {props.alertId && <Text style={styles.muted}>Linked to alert {props.alertId}</Text>}

        <Text style={styles.label}>What did you see?</Text>
        <View style={styles.row}>
          {REPORT_CATEGORIES.map((c) => (
            <Chip
              key={c}
              label={CATEGORY_LABELS[c]}
              selected={draft.category === c}
              onPress={() => dispatch({ type: 'setCategory', category: c })}
            />
          ))}
        </View>
        {draft.category && <Text style={styles.muted}>{CATEGORY_HINTS[draft.category]}</Text>}
        <Text style={styles.muted}>{CATEGORY_VOCABULARY_NOTE}</Text>
        <Issues field="category" />

        <Text style={styles.label}>{props.citizenMode ? 'How serious does it look?' : 'Severity'}</Text>
        <View style={styles.row}>
          {REPORT_SEVERITIES.map((s) => (
            <Chip
              key={s}
              label={s}
              selected={draft.severity === s}
              onPress={() => dispatch({ type: 'setSeverity', severity: s })}
            />
          ))}
        </View>
        <Issues field="severity" />

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
          multiline
          value={draft.description}
          onChangeText={(text) => dispatch({ type: 'setDescription', text })}
          placeholder={props.citizenMode ? 'What is happening, and where exactly?' : 'Observation, extent, access impact'}
        />
        <Issues field="description" />

        <Text style={styles.label}>Location</Text>
        {!draft.location_adjusted_manually && (
          <>
            {state.gps.kind === 'locating' && <Text style={styles.body}>Getting GPS fix… (works without mobile data)</Text>}
            {state.gps.kind === 'fix' && draft.lat !== null && draft.lon !== null && (
              <Text style={styles.body}>
                GPS {draft.lat.toFixed(5)}, {draft.lon.toFixed(5)} · accuracy{' '}
                <Text style={{ fontWeight: '700', color: quality === 'good' ? colors.ok : colors.warn }}>
                  {draft.gps_accuracy_m !== null ? `±${Math.round(draft.gps_accuracy_m)} m` : 'not reported'}
                </Text>
              </Text>
            )}
            {state.gps.kind === 'failed' && <Text style={styles.error}>{state.gps.error}</Text>}
            {advice && <Text style={[styles.muted, { color: colors.warn }]}>{advice}</Text>}
            {state.gps.kind !== 'locating' && <Button title="Refresh GPS" kind="secondary" onPress={() => void locate()} />}
          </>
        )}
        <View style={[styles.row, { justifyContent: 'space-between', marginTop: 6 }]}>
          <Text style={styles.body}>Adjust pin manually</Text>
          <Switch
            value={draft.location_adjusted_manually}
            onValueChange={(on) => {
              dispatch({ type: 'setManual', on });
              if (!on) void locate();
            }}
          />
        </View>
        {draft.location_adjusted_manually && (
          <View>
            <Text style={[styles.muted, { color: colors.warn }]}>
              The report will state that the location was set by hand, with your uncertainty estimate.
            </Text>
            <Text style={styles.label}>Latitude</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={state.latText}
              onChangeText={(text) => dispatch({ type: 'setLatText', text })}
            />
            <Text style={styles.label}>Longitude</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={state.lonText}
              onChangeText={(text) => dispatch({ type: 'setLonText', text })}
            />
            <Text style={styles.label}>How far off could the pin be? (metres)</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={state.uncertaintyText}
              onChangeText={(text) => dispatch({ type: 'setUncertaintyText', text })}
            />
          </View>
        )}
        <Issues field="location" />
        <Issues field="accuracy" />

        <Text style={styles.label}>
          Photos and video ({counts.photos} photo(s), {counts.videos} video(s), max {MAX_MEDIA_PER_REPORT})
        </Text>
        {draft.media.map((m) => (
          <Card key={m.local_uri} style={{ flexDirection: 'row', alignItems: 'center', padding: 8 }}>
            {m.media_type === 'PHOTO' ? (
              <Image source={{ uri: m.local_uri }} style={{ width: 56, height: 56, borderRadius: 4, marginRight: 8 }} />
            ) : (
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 4,
                  marginRight: 8,
                  backgroundColor: colors.text,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>VIDEO</Text>
              </View>
            )}
            <Text style={[styles.body, { flex: 1 }]}>
              {m.media_type === 'PHOTO' ? 'Photo' : `Video · ${m.duration_s !== null ? m.duration_s.toFixed(1) : '?'} s`} ·{' '}
              {(m.size_bytes / 1_000_000).toFixed(1)} MB
            </Text>
            <Button title="Remove" kind="secondary" onPress={() => removeMedia(m.local_uri)} />
          </Card>
        ))}
        {state.mediaError && <Text style={styles.error}>{state.mediaError}</Text>}
        <Issues field="media" />
        <View style={styles.row}>
          <Button
            title="Take photo"
            kind="secondary"
            disabled={busy !== 'idle' || counts.atLimit}
            onPress={() => void addMedia('PHOTO')}
            style={{ marginRight: 8 }}
          />
          <Button
            title={`Record video (up to ${VIDEO_CAPTURE_MAX_S} s)`}
            kind="secondary"
            disabled={busy !== 'idle' || counts.atLimit}
            onPress={() => void addMedia('VIDEO')}
          />
        </View>

        {state.showIssues && issues.length > 0 && (
          <Text style={[styles.error, { fontWeight: '700' }]}>
            {issues.length} thing(s) to fix before saving (see the messages above).
          </Text>
        )}
        {state.saveError && <Text style={styles.error}>{state.saveError}</Text>}
        <Button title={busy === 'saving' ? 'Saving…' : 'Save report'} onPress={() => void save()} disabled={busy !== 'idle'} />
        <Button title="Cancel" kind="secondary" onPress={cancel} disabled={busy === 'saving'} />
        <Text style={styles.muted}>
          The report is saved on this device first, even with no network, and is sent automatically when a
          connection is available.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
