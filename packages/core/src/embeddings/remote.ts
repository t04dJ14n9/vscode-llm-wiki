import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export interface RemoteEmbeddingConfig {
  provider: 'ollama' | 'openai-compatible';
  model: string;
  base_url: string;
  api_key?: string;
  dimensions?: number;
}

export async function embedTextRemote(text: string, config: RemoteEmbeddingConfig): Promise<number[]> {
  const url = new URL(
    config.provider === 'ollama' ? '/api/embeddings' : '/v1/embeddings',
    config.base_url,
  );

  const body = config.provider === 'ollama'
    ? JSON.stringify({ model: config.model, prompt: text })
    : JSON.stringify({ model: config.model, input: text });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Content-Length': String(Buffer.byteLength(body)),
  };
  if (config.provider === 'openai-compatible' && config.api_key) {
    headers['Authorization'] = `Bearer ${config.api_key}`;
  }

  const json = await httpPost(url, body, headers);

  if (config.provider === 'ollama') {
    const embedding = (json as { embedding?: number[] }).embedding;
    if (!Array.isArray(embedding)) throw new Error('Ollama response missing embedding field');
    return embedding;
  } else {
    const data = (json as { data?: Array<{ embedding?: number[] }> }).data;
    const embedding = data?.[0]?.embedding;
    if (!Array.isArray(embedding)) throw new Error('OpenAI response missing data[0].embedding');
    return embedding;
  }
}

function httpPost(url: URL, body: string, headers: Record<string, string>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Invalid JSON response: ${data.slice(0, 200)}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
