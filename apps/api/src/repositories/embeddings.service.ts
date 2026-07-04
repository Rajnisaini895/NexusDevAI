import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface OllamaEmbeddingsResponse {
  embeddings?: number[][];
  error?: string;
}

@Injectable()
export class EmbeddingsService {
  readonly model: string;
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.model =
      this.configService.get<string>('OLLAMA_EMBEDDING_MODEL') ??
      'embeddinggemma';
    this.baseUrl = (
      this.configService.get<string>('OLLAMA_BASE_URL') ??
      'http://localhost:11434'
    ).replace(/\/$/, '');
  }

  async create(inputs: string[]): Promise<number[][]> {
    if (inputs.length === 0) return [];

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          input: inputs,
          truncate: true,
        }),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Ollama is not running. Start Ollama and try again',
      );
    }

    const result = (await response.json()) as OllamaEmbeddingsResponse;
    if (!response.ok) {
      const modelMissing =
        response.status === 404 || result.error?.includes('not found');
      throw new BadGatewayException(
        modelMissing
          ? `Ollama model ${this.model} is not installed`
          : result.error || 'Ollama rejected the embedding request',
      );
    }

    const embeddings = result.embeddings ?? [];
    const dimensions = embeddings[0]?.length ?? 0;
    if (
      embeddings.length !== inputs.length ||
      dimensions === 0 ||
      embeddings.some((embedding) => embedding.length !== dimensions)
    ) {
      throw new BadGatewayException(
        'Ollama returned an invalid embedding response',
      );
    }

    return embeddings;
  }
}
