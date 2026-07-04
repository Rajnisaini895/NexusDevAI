import { ConfigService } from '@nestjs/config';

import { OllamaGenerationService } from './ollama-generation.service';

describe('OllamaGenerationService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('generates a grounded answer from repository sources', async () => {
    const configService = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    const service = new OllamaGenerationService(configService);
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ response: 'AuthService validates credentials.' }),
          { status: 200 },
        ),
      );

    await expect(
      service.answer('Where is authentication handled?', [
        {
          path: 'src/auth.service.ts',
          startLine: 10,
          endLine: 30,
          content: 'export class AuthService {}',
        },
      ]),
    ).resolves.toEqual({
      answer: 'AuthService validates credentials.',
      model: 'qwen2.5-coder:3b',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/generate',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
