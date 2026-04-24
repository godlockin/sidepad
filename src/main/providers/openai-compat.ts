import { OpenAIProvider } from './openai';

export class OpenAICompatProvider extends OpenAIProvider {
  constructor(id: string, configId: string, apiKey: string, baseURL: string) {
    super(id, configId, apiKey, baseURL);
  }
}
