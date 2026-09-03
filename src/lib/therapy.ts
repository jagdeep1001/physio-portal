export const THERAPY_SEPARATOR = '|';

export const THERAPY_GROUPS = [
  {
    label: 'Basic',
    options: ['US', 'TENS', 'IFT', 'Hot pack', 'WAX THERAPY', 'CERVICAL TRACTION', 'LUMBAR TRACTION'],
  },
  {
    label: 'Rehab',
    options: [
      'Rehab',
      'Strengthening Exercises',
      'Stretching Exercises',
      'ROM Exercises',
      'Balance Training',
      'Gait Training',
      'Posture Training',
    ],
  },
  {
    label: 'Advance',
    options: [
      'Static Cupping',
      'Dynamic cupping',
      'Wet Cupping/Hijama',
      'Dry Needling',
      'IASTM',
      'Taping',
      'Fire Cupping',
      'Electro Needling',
    ],
  },
] as const;

export function splitTherapyTypes(value: string): string[] {
  return value ? value.split(THERAPY_SEPARATOR).map((s) => s.trim()).filter(Boolean) : [];
}

export function groupedTherapyTypes(value: string): Array<{ label: string; options: string[] }> {
  const selected = splitTherapyTypes(value);
  if (selected.length === 0) return [];
  const matched = new Set<string>();
  const grouped = THERAPY_GROUPS
    .map((group) => {
      const options = group.options.filter((option) => selected.includes(option));
      options.forEach((option) => matched.add(option));
      return { label: group.label, options };
    })
    .filter((group) => group.options.length > 0);
  const custom = selected.filter((option) => !matched.has(option));
  return custom.length > 0 ? [...grouped, { label: 'Other', options: custom }] : grouped;
}

export function inferredTherapyLevel(value: string): 'basic' | 'rehab' | 'advance' {
  const groups = groupedTherapyTypes(value).map((group) => group.label);
  if (groups.includes('Advance')) return 'advance';
  if (groups.includes('Rehab')) return 'rehab';
  return 'basic';
}

/** Display therapy list with spaced separators, e.g. "US | TENS | IFT". */
export function formatTherapyTypeDisplay(value: string): string {
  if (!value) return '';
  return splitTherapyTypes(value).join(' | ');
}
