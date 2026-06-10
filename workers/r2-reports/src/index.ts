export interface Env {
  REPORTS_BUCKET: R2Bucket;
  R2_API_TOKEN: string;
  ALLOWED_ORIGINS: string;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

function corsHeaders(origin: string | null, env: Env): HeadersInit {
  const allowed = env.ALLOWED_ORIGINS.split(',').map((value) => value.trim());
  const allowOrigin =
    allowed.includes('*') || (origin && allowed.includes(origin))
      ? origin ?? allowed[0] ?? '*'
      : allowed[0] ?? '*';

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data: unknown, status: number, origin: string | null, env: Env): Response {
  return Response.json(data, { status, headers: corsHeaders(origin, env) });
}

function unauthorized(origin: string | null, env: Env): Response {
  return json({ error: 'Unauthorized' }, 401, origin, env);
}

function authorize(request: Request, env: Env): boolean {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return Boolean(env.R2_API_TOKEN) && token === env.R2_API_TOKEN;
}

function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'report';
  const cleaned = base.replace(/[^\w.\-() ]+/g, '_').trim();
  return cleaned || 'report';
}

function buildObjectKey(patientId: string, reportId: string, fileName: string): string {
  return `patients/${patientId}/reports/${reportId}/${sanitizeFileName(fileName)}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    }

    if (!authorize(request, env)) {
      return unauthorized(origin, env);
    }

    if (request.method === 'POST' && url.pathname === '/upload') {
      return handleUpload(request, env, origin);
    }

    if (request.method === 'GET' && url.pathname === '/download') {
      return handleDownload(url, env, origin);
    }

    if (request.method === 'DELETE' && url.pathname === '/patient-reports') {
      return handleDeletePatientReports(url, env, origin);
    }

    return json({ error: 'Not found' }, 404, origin, env);
  },
};

async function handleUpload(request: Request, env: Env, origin: string | null): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: 'Expected multipart form data' }, 400, origin, env);
  }

  const patientId = String(formData.get('patientId') ?? '').trim();
  const reportId = String(formData.get('reportId') ?? '').trim();
  const file = formData.get('file');

  if (!patientId || !reportId) {
    return json({ error: 'patientId and reportId are required' }, 400, origin, env);
  }

  if (!(file instanceof File)) {
    return json({ error: 'file is required' }, 400, origin, env);
  }

  if (file.size === 0) {
    return json({ error: 'File is empty' }, 400, origin, env);
  }

  if (file.size > MAX_FILE_BYTES) {
    return json({ error: 'File exceeds 10 MB limit' }, 413, origin, env);
  }

  const contentType = file.type || 'application/octet-stream';
  if (!ALLOWED_TYPES.has(contentType)) {
    return json({ error: 'Unsupported file type' }, 415, origin, env);
  }

  const key = buildObjectKey(patientId, reportId, file.name);

  await env.REPORTS_BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType },
    customMetadata: {
      patientId,
      reportId,
      originalName: file.name,
    },
  });

  return json({ key, fileName: sanitizeFileName(file.name) }, 200, origin, env);
}

async function handleDownload(url: URL, env: Env, origin: string | null): Promise<Response> {
  const key = url.searchParams.get('key')?.trim();
  if (!key || key.includes('..')) {
    return json({ error: 'Valid key is required' }, 400, origin, env);
  }

  const object = await env.REPORTS_BUCKET.get(key);
  if (!object) {
    return json({ error: 'File not found' }, 404, origin, env);
  }

  const headers = new Headers(corsHeaders(origin, env));
  headers.set('Content-Type', object.httpMetadata?.contentType ?? 'application/octet-stream');
  headers.set('Content-Disposition', `inline; filename="${sanitizeFileName(object.customMetadata?.originalName ?? 'report')}"`);
  if (object.size) headers.set('Content-Length', String(object.size));

  return new Response(object.body, { status: 200, headers });
}

async function handleDeletePatientReports(url: URL, env: Env, origin: string | null): Promise<Response> {
  const patientId = url.searchParams.get('patientId')?.trim();
  if (!patientId || patientId.includes('..') || patientId.includes('/')) {
    return json({ error: 'Valid patientId is required' }, 400, origin, env);
  }

  const prefix = `patients/${patientId}/`;
  let deleted = 0;
  let cursor: string | undefined;

  do {
    const listed = await env.REPORTS_BUCKET.list({ prefix, cursor });
    await Promise.all(listed.objects.map((object) => env.REPORTS_BUCKET.delete(object.key)));
    deleted += listed.objects.length;
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return json({ deleted }, 200, origin, env);
}
