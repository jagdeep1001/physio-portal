export const THERAPY_SEPARATOR = '|';

export const THERAPY_GROUPS = [
  {
    label: 'Basic',
    options: ['US', 'TENS', 'IFT', 'Hot pack', 'WAX THERAPY', 'TRACTION (CERVICAL/LUMBAR)'],
  },
  {
    label: 'Advanced',
    options: [
      'Cupping Static/Dynamic',
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

/** Display therapy list with spaced separators, e.g. "US | TENS | IFT". */
export function formatTherapyTypeDisplay(value: string): string {
  if (!value) return '';
  return splitTherapyTypes(value).join(' | ');
}
