/* eslint-disable prettier/prettier */
import { utilities as nestWinstonModuleUtilities, WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import 'winston-daily-rotate-file';
import { ClsService } from 'nestjs-cls';

// Sanitize sensitive data from logs
const sensitiveFields = ['password', 'token', 'authorization', 'cookie'];
const sanitize = winston.format((info) => {
  const newInfo = { ...info };
  const body = newInfo.meta?.body || {};

  for (const field of sensitiveFields) {
    if (body[field]) {
      body[field] = 'REDACTED';
    }
  }

  if (newInfo.meta) {
    newInfo.meta.body = body;
  }
  return newInfo;
});

export const createWinstonLogger = (clsService: ClsService) => {
  const logFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
    const requestId = clsService.get('requestId');
    let log = `${timestamp} [${level}]`;
    if (requestId) {
      log += ` [${requestId}]`;
    }
    log += `: ${message}`;
    if (metadata && Object.keys(metadata).length > 0) {
      log += ` - ${JSON.stringify(metadata)}`;
    }
    return log;
  });

  return WinstonModule.createLogger({
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.ms(),
          nestWinstonModuleUtilities.format.nestLike('Proof-Stell', {
            colors: true,
            prettyPrint: true,
          }),
        ),
      }),
      new winston.transports.DailyRotateFile({
        filename: 'logs/application-%DATE%.log',
        datePattern: 'YYYY-MM-DD-HH',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '14d',
        format: winston.format.combine(
          winston.format.timestamp(),
          sanitize(),
          logFormat,
        ),
      }),
      new winston.transports.DailyRotateFile({
        filename: 'logs/errors-%DATE%.log',
        level: 'error',
        datePattern: 'YYYY-MM-DD-HH',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '14d',
        format: winston.format.combine(
          winston.format.timestamp(),
          sanitize(),
          logFormat,
        ),
      }),
    ],
  });
};
