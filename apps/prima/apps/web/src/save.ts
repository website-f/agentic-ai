// Saving a file for the user. Inside the Claude test-link viewer a page may not download directly, so the file goes
// through the viewer's save prompt; in the installed app and the browser it is an ordinary download.

interface ClaudeDownloads {
  save(req: { filename: string; data: string | Blob }): Promise<{ status: string }>;
}
interface ClaudeHost {
  use(name: 'downloads'): Promise<ClaudeDownloads | null>;
}

function dataUrlToBlob(url: string): Blob {
  const [head, body] = url.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Saves a file. Resolves with a message to show when it could not be saved here. */
export async function saveFile(filename: string, data: Blob | string): Promise<string | null> {
  const blob = typeof data === 'string' && data.startsWith('data:') ? dataUrlToBlob(data) : data;
  const host = (window as unknown as { claude?: ClaudeHost }).claude;
  if (host?.use) {
    const downloads = await host.use('downloads').catch(() => null);
    if (downloads) {
      try {
        await downloads.save({ filename, data: blob });
        return null;
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === 'declined') return null;
        if (code === 'rejected_extension' || code === 'extension_not_enabled')
          return 'This kind of file cannot be saved from the test link. It works in the installed app.';
        return 'The file could not be saved here.';
      }
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(typeof blob === 'string' ? new Blob([blob]) : blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return null;
}
