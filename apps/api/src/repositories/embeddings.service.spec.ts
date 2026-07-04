import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EmbeddingsService } from './embeddings.service';

describe('EmbeddingsService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('creates local Ollama embeddings for a batch of inputs', async () => {
    const configService = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    const service = new EmbeddingsService(configService);
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          embeddings: [
            [1, 0],
            [0, 1],
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(service.create(['auth', 'workspace'])).resolves.toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/embed',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          model: 'embeddinggemma',
          input: ['auth', 'workspace'],
          truncate: true,
        }),
      }),
    );
  });

  it('reports when the local Ollama server is unavailable', async () => {
    const configService = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    const service = new EmbeddingsService(configService);
    global.fetch = jest.fn().mockRejectedValue(new Error('connection refused'));

    await expect(service.create(['auth'])).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
