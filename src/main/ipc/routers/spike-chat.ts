import { observable } from '@trpc/server/observable';
import type { Observer, TeardownLogic } from '@trpc/server/observable';
import OpenAI from 'openai';
import { z } from 'zod';

import { initTRPC } from '@trpc/server';

const t = initTRPC.create({ isServer: true });

export const spikeChatRouter = t.router({
  stream: t.procedure
    .input(z.object({ messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string() })) }))
    .subscription(({ input }) => {
      return observable<string, Error>((observer: Observer<string, Error>): TeardownLogic => {
        const abortController = new AbortController();
        const apiKey = process.env.OPENAI_API_KEY ?? '';

        if (!apiKey) {
          observer.error(new Error('OPENAI_API_KEY environment variable is not set'));
          return;
        }

        const openai = new OpenAI({ apiKey });

        async function run() {
          try {
            const stream = await openai.chat.completions.create(
              {
                model: 'gpt-4o-mini',
                messages: input.messages,
                stream: true,
              },
              { signal: abortController.signal }
            );

            for await (const chunk of stream) {
              const delta = chunk.choices[0]?.delta?.content;
              if (delta) {
                observer.next(delta);
              }
            }

            observer.complete();
          } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
              observer.complete();
            } else {
              observer.error(error instanceof Error ? error : new Error(String(error)));
            }
          }
        }

        void run();

        return () => {
          abortController.abort();
        };
      });
    }),
});
