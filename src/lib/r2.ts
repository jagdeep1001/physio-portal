const r2ApiUrl = import.meta.env.VITE_R2_API_URL as string | undefined;
const r2ApiToken = import.meta.env.VITE_R2_API_TOKEN as string | undefined;

export const isR2Configured = Boolean(r2ApiUrl && r2ApiToken);

export function isStoredReportKey(value: string | undefined): boolean {
  return Boolean(value && value.startsWith('patients/'));
}

export async function uploadPatientReport(
  patientId: string,
  reportId: string,
  file: File,
): Promise<{ key: string; fileName: string }> {
  if (!isR2Configured) {
    throw new Error('Cloudflare R2 is not configured. Add VITE_R2_API_URL and VITE_R2_API_TOKEN.');
  }

  const formData = new FormData();
  formData.append('patientId', patientId);
  formData.append('reportId', reportId);
  formData.append('file', file);

  const response = await fetch(`${r2ApiUrl!.replace(/\/$/, '')}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${r2ApiToken}` },
    body: formData,
  });

  const payload = (await response.json().catch(() => ({}))) as {
    key?: string;
    fileName?: string;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error ?? 'Could not upload report file.');
  }

  if (!payload.key) {
    throw new Error('Upload succeeded but no storage key was returned.');
  }

  return { key: payload.key, fileName: payload.fileName ?? file.name };
}

export function getReportDownloadUrl(fileKey: string): string {
  if (!isR2Configured) {
    throw new Error('Cloudflare R2 is not configured.');
  }
  const base = r2ApiUrl!.replace(/\/$/, '');
  return `${base}/download?key=${encodeURIComponent(fileKey)}`;
}

export async function openStoredReport(fileKey: string): Promise<void> {
  const url = getReportDownloadUrl(fileKey);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${r2ApiToken}` },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? 'Could not open report file.');
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  window.open(objectUrl, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

export async function deletePatientReports(patientId: string): Promise<number> {
  if (!isR2Configured) return 0;

  const response = await fetch(
    `${r2ApiUrl!.replace(/\/$/, '')}/patient-reports?patientId=${encodeURIComponent(patientId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${r2ApiToken}` },
    },
  );

  const payload = (await response.json().catch(() => ({}))) as { deleted?: number; error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? 'Could not delete report files.');
  }

  return payload.deleted ?? 0;
}

export const ACCEPTED_REPORT_TYPES = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx';
