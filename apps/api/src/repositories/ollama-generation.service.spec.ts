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

  it('generates schema-constrained findings and keeps only verified issues', async () => {
    const configService = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    const service = new OllamaGenerationService(configService);
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            response: JSON.stringify({
              reviews: [
                {
                  title: 'Unvalidated token',
                  description: 'The token is consumed before validation.',
                  severity: 'HIGH',
                  filePath: 'src/auth.ts',
                  startLine: 12,
                  endLine: 12,
                  suggestion: 'Validate the token before reading its claims.',
                },
              ],
            }),
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            response: JSON.stringify({
              verdicts: [{ index: 0, valid: true }],
            }),
          }),
          { status: 200 },
        ),
      );

    await expect(
      service.reviewCode([
        {
          path: 'src/auth.ts',
          startLine: 10,
          endLine: 20,
          content: 'const token = decode(input);',
        },
      ]),
    ).resolves.toEqual({
      model: 'qwen2.5-coder:3b',
      reviews: [
        expect.objectContaining({
          title: 'Unvalidated token',
          severity: 'HIGH',
          filePath: 'src/auth.ts',
        }),
      ],
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const firstRequest = jest.mocked(global.fetch).mock.calls.at(0)?.[1];
    expect(typeof firstRequest?.body).toBe('string');
    if (typeof firstRequest?.body !== 'string') {
      throw new Error('Expected a JSON request body');
    }
    const requestBody = JSON.parse(firstRequest.body) as {
      format: { required: string[] };
      options: { temperature: number };
    };
    expect(requestBody.format.required).toEqual(['reviews']);
    expect(requestBody.options.temperature).toBe(0.1);
  });

  it('rejects generic or out-of-source findings before verification', async () => {
    const configService = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    const service = new OllamaGenerationService(configService);
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          response: JSON.stringify({
            reviews: [
              {
                title: 'Code Review',
                description: 'Consider improving this code.',
                severity: 'LOW',
                filePath: 'invented.ts',
                startLine: 1,
                endLine: 1,
                suggestion: 'Add more comments.',
              },
            ],
          }),
        }),
        { status: 200 },
      ),
    );

    await expect(
      service.reviewCode([
        {
          path: 'src/auth.ts',
          startLine: 10,
          endLine: 20,
          content: 'export const ready = true;',
        },
      ]),
    ).resolves.toEqual({ reviews: [], model: 'qwen2.5-coder:3b' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('drops candidates rejected by the second-pass verifier', async () => {
    const configService = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    const service = new OllamaGenerationService(configService);
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            response: JSON.stringify({
              reviews: [
                {
                  title: 'Possible defect',
                  description: 'This may fail.',
                  severity: 'MEDIUM',
                  filePath: 'src/main.ts',
                  startLine: 1,
                  endLine: 1,
                  suggestion: null,
                },
              ],
            }),
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            response: JSON.stringify({
              verdicts: [{ index: 0, valid: false }],
            }),
          }),
          { status: 200 },
        ),
      );

    await expect(
      service.reviewCode([
        {
          path: 'src/main.ts',
          startLine: 1,
          endLine: 5,
          content: 'const ready = true;',
        },
      ]),
    ).resolves.toEqual({ reviews: [], model: 'qwen2.5-coder:3b' });
  });
});
