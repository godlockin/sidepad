import pino from 'pino';

export const log = pino({
  level:
    process.env.SIDEPAD_LOG_LEVEL ??
    (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});
