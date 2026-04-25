import fs from 'node:fs';
import path from 'node:path';
import type { ChatMessage, LLMProvider, ImageInput } from '../providers/types';

/**
 * Vision-routing helper.
 *
 * Scans a session's recently-uploaded image attachments and, if the active
 * provider+model has `capabilities(model).vision === true`, attaches the raw
 * image bytes as `images: ImageInput[]` on the *last* user message. The
 * provider-specific `to{OpenAI,Anthropic,Ollama}Messages` mappers translate
 * those into native vision blocks.
 *
 * If the model is NOT vision-capable, this is a no-op — the OCR'd text from
 * `parsers/image.ts` is already inlined as `<attachment>...</attachment>`
 * markdown by the renderer, so the model still gets *some* signal.
 *
 * The helper is intentionally **side-effect free** on the input array — it
 * returns a new messages list with the last user message rewritten.
 */
export interface AttachmentLike {
  filename: string;
  mime: string | null;
  storage_path: string;
}

export function transformMessagesForVision(
  messages: ChatMessage[],
  attachments: AttachmentLike[],
  provider: LLMProvider | null,
  model: string,
): ChatMessage[] {
  if (!provider || !attachments || attachments.length === 0) return messages;
  const caps = provider.capabilities?.(model);
  if (!caps?.vision) return messages;

  const images: ImageInput[] = [];
  for (const a of attachments) {
    if (!isImageAttachment(a)) continue;
    try {
      const buf = fs.readFileSync(a.storage_path);
      images.push({
        mime: normalizeMime(a.mime, a.filename),
        base64: buf.toString('base64'),
      });
    } catch {
      // skip unreadable file rather than failing the whole turn
    }
  }
  if (images.length === 0) return messages;

  // Find the last user message and attach images to it.
  const out = messages.slice();
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === 'user') {
      const u = out[i] as Extract<ChatMessage, { role: 'user' }>;
      // Strip the inline OCR <attachment> blocks for image attachments since
      // we're now sending the raw bytes — keeps the prompt smaller.
      const stripped = stripImageAttachmentBlocks(u.content, attachments);
      out[i] = { ...u, content: stripped, images };
      break;
    }
  }
  return out;
}

function isImageAttachment(a: AttachmentLike): boolean {
  if (a.mime && a.mime.toLowerCase().startsWith('image/')) return true;
  const ext = (a.filename.split('.').pop() ?? '').toLowerCase();
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext);
}

function normalizeMime(mime: string | null, filename: string): string {
  if (mime && mime.toLowerCase().startsWith('image/')) return mime.toLowerCase();
  const ext = (path.extname(filename) || '').slice(1).toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'bmp') return 'image/bmp';
  return 'image/png';
}

/**
 * Remove the `<attachment ...>...</attachment>` blocks for image files from
 * the inline user text. Non-image attachments (pdf/docx/etc) are kept inline.
 */
function stripImageAttachmentBlocks(text: string, attachments: AttachmentLike[]): string {
  let out = text;
  for (const a of attachments) {
    if (!isImageAttachment(a)) continue;
    // Match <attachment ... filename="<a.filename>" ...>...</attachment>
    const fnEsc = a.filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `\\n*<attachment[^>]*filename="${fnEsc}"[\\s\\S]*?<\\/attachment>\\n*`,
      'g',
    );
    out = out.replace(re, '\n');
  }
  return out.trim();
}
