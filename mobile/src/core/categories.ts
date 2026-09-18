import { ReportCategory } from './types';

/**
 * Display labels for the frozen report categories (docs/api.md §5.6,
 * database.md §4.15). The enum values are fixed: field wording that reporters
 * recognise ("slope movement", "sinking road") is only ever a label or hint on
 * one of these seven values, never a new value.
 */
export const CATEGORY_LABELS: Record<ReportCategory, string> = {
  LANDSLIDE: 'Landslide / slope movement',
  CRACK: 'Crack',
  SEEPAGE: 'Seepage / water',
  ROCKFALL: 'Rockfall',
  ROAD_BLOCKED: 'Road blocked',
  SUBSIDENCE: 'Subsidence / sinking',
  OTHER: 'Other',
};

/** One line of plain guidance per category, shown under the chosen chip. */
export const CATEGORY_HINTS: Record<ReportCategory, string> = {
  LANDSLIDE: 'Debris, slipped slope or ground moving downhill. Slope movement is reported as LANDSLIDE.',
  CRACK: 'New or widening cracks in the ground, a slope or a structure.',
  SEEPAGE: 'Water coming out of a slope or road, or unusually wet ground.',
  ROCKFALL: 'Falling or fallen rocks and boulders.',
  ROAD_BLOCKED: 'Road not passable: debris, slip, washout or a fallen tree.',
  SUBSIDENCE: 'Ground or road surface sinking or settling.',
  OTHER: 'Anything else worth checking. Describe it below.',
};

/** Shown under the category chips, so the mapping is disclosed rather than hidden. */
export const CATEGORY_VOCABULARY_NOTE =
  'The labels map onto the seven report categories used across GeoRakshak (for example slope movement is sent ' +
  'as LANDSLIDE, and a sinking road as SUBSIDENCE).';

export function categoryLabel(category: ReportCategory): string {
  return CATEGORY_LABELS[category];
}
