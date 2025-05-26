import type { NextFunction, Request, Response } from '@tinyhttp/app';
import chalk from 'chalk';
import dayjs from 'dayjs';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

/**
 * Enum for log levels.
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

/**
 * Options for configuring log rotation.
 */
export type LogRotationOptions = {
  /** Date pattern for log file names. Default: 'YYYY-MM-DD' */
  datePattern?: string;
  /** Whether to compress archived log files. Default: true */
  zippedArchive?: boolean;
  /** Maximum size of a log file before rotation. Default: '20m' */
  maxSize?: string;
  /** Maximum number of log files to keep. Default: '14d' */
  maxFiles?: string;
};

/**
 * File logging configuration options.
 */
export type FileLoggingOptions = {
  /** The file name pattern for log files (use %DATE% if using daily rotation). */
  filename: string;
  /** Log level for file logging. Defaults to the overall log level if not provided. */
  level?: LogLevel;
  /** If true, file logs are output in JSON format. */
  json?: boolean;
  /** Optional log rotation options. Log rotation is enabled by default. */
  rotation?: LogRotationOptions;
  /**
   * Optional custom formatting function for request logs written to file.
   * Receives an object with timestamp, requestId, method, url, and ip.
   */
  customFileRequestFormat?: (data: {
    timestamp: string;
    requestId: string;
    method: string;
    url: string;
    ip: string;
  }) => string;
  /**
   * Optional custom formatting function for response logs written to file.
   * Receives an object with timestamp, requestId, statusCode, statusMessage, method, url, duration, emoji, and ip.
   */
  customFileResponseFormat?: (data: {
    timestamp: string;
    requestId: string;
    statusCode: number;
    statusMessage: string;
    method: string;
    url: string;
    duration: number;
    emoji: string;
    ip: string;
  }) => string;
};

/**
 * Options to customize the request logger.
 */
export type RequestLoggerOptions = {
  /** Overall log level for controlling verbosity. */
  logLevel?: LogLevel;
  /** Dayjs timestamp format. */
  timestampFormat?: string;
  /** Enable or disable emojis for response status codes. */
  enableEmoji?: boolean;
  /** Custom prefix for all log messages. */
  prefix?: string;
  /**
   * Custom formatting function for incoming request logs.
   * Receives an object with timestamp, requestId, method, and url.
   */
  customRequestFormat?: (data: {
    timestamp: string;
    requestId: string;
    method: string;
    url: string;
  }) => string;
  /**
   * Custom formatting function for response logs.
   * Receives an object with timestamp, requestId, statusCode, statusMessage, method, url, duration, and emoji.
   */
  customResponseFormat?: (data: {
    timestamp: string;
    requestId: string;
    statusCode: number;
    statusMessage: string;
    method: string;
    url: string;
    duration: number;
    emoji: string;
  }) => string;
  /** File logging configuration. */
  fileLogging?: FileLoggingOptions;
};

const defaultOptions: RequestLoggerOptions = {
  logLevel: LogLevel.INFO,
  timestampFormat: 'HH:mm:ss',
  enableEmoji: true,
  prefix: '[q-mock]',
};

// Mapping of HTTP methods to their chalk color functions.
const methodColor: Record<string, (text: string) => string> = {
  GET: chalk.green,
  POST: chalk.blue,
  PUT: chalk.yellow,
  DELETE: chalk.red,
  PATCH: chalk.magenta,
  HEAD: chalk.gray,
  OPTIONS: chalk.cyan,
};

// Custom emoji mapping for common HTTP response codes.
const emojiMap: Record<number, string> = {
  200: '😀',
  201: '😁',
  202: '😄',
  204: '👍',
  400: '😕',
  401: '😟',
  403: '🚫',
  404: '😞',
  500: '😡',
  502: '🤬',
  503: '🔥',
};

/**
 * Returns an emoji for a given status code.
 */
const getEmoji = (statusCode: number): string => {
  if (emojiMap[statusCode]) return emojiMap[statusCode];
  if (statusCode >= 200 && statusCode < 300) return '✅';
  if (statusCode >= 400 && statusCode < 500) return '⚠️';
  if (statusCode >= 500) return '💥';
  return '';
};

/**
 * Determines whether a message should be logged based on the provided log level.
 *
 * @param statusCode - The HTTP status code (if available).
 * @param logLevel - The current log level.
 * @returns A boolean indicating whether to log.
 */
const shouldLog = (
  statusCode: number | undefined,
  logLevel: LogLevel
): boolean => {
  // For incoming requests (no status code), log only for debug or info.
  if (statusCode === undefined) {
    return logLevel === LogLevel.DEBUG || logLevel === LogLevel.INFO;
  }
  if (logLevel === LogLevel.DEBUG || logLevel === LogLevel.INFO) {
    return true;
  }
  if (
    (logLevel === LogLevel.WARN || logLevel === LogLevel.ERROR) &&
    statusCode >= 400
  ) {
    return true;
  }
  return false;
};

/**
 * Express middleware for logging requests and responses.
 *
 * Logs incoming requests and, when the response finishes, logs detailed response info.
 * Console log ordering:
 *   - Request: [prefix] [timestamp] [requestId] <METHOD> <url>
 *   - Response: [prefix] [timestamp] [requestId] <statusCode> <METHOD> <url> -> <statusMessage> <emoji> - <duration>ms
 *
 * File logs include the client's IP address and a tag indicating whether the log is a REQUEST or RESPONSE.
 * For response logs, the file log ordering is: METHOD CODE EMOJI MESSAGE TIMEELAPSED.
 * File logs are written using winston and winston-daily-rotate-file, with rotation enabled by default.
 */
export const requestLogger = (options: RequestLoggerOptions = {}) => {
  const opts = { ...defaultOptions, ...options };

  // Set default rotation options if not provided.
  const defaultRotationOptions: LogRotationOptions = {
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '14d',
  };
  const rotationOptions = opts.fileLogging?.rotation
    ? { ...defaultRotationOptions, ...opts.fileLogging.rotation }
    : defaultRotationOptions;

  // Set up winston file logger with log rotation if fileLogging options are provided.
  let fileLogger: winston.Logger | null = null;
  if (opts.fileLogging) {
    fileLogger = winston.createLogger({
      level: opts.fileLogging.level || opts.logLevel,
      format: opts.fileLogging.json
        ? winston.format.combine(
            winston.format.timestamp({ format: opts.timestampFormat }),
            winston.format.json()
          )
        : winston.format.combine(
            winston.format.timestamp({ format: opts.timestampFormat }),
            winston.format.printf(info => info.message as string)
          ),
      transports: [
        new DailyRotateFile({
          filename: opts.fileLogging.filename,
          level: opts.fileLogging.level || opts.logLevel,
          ...rotationOptions,
        }),
      ],
    });
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = req['request_id'];
    const requestTimestamp = req['timestamp'];
    const startTime = Date.now();

    const timestamp = dayjs(requestTimestamp).format(opts.timestampFormat);
    const ip = req.ip || req.connection?.remoteAddress || 'N/A';

    // Safely decode the URL.
    const decodedUrl = (() => {
      try {
        return decodeURIComponent(req.url);
      } catch (error) {
        return req.url;
      }
    })();

    // Console: Log incoming request.
    if (shouldLog(undefined, opts.logLevel!)) {
      if (opts.customRequestFormat) {
        console.log(
          opts.customRequestFormat({
            timestamp,
            requestId,
            method: req.method.toUpperCase(),
            url: decodedUrl,
          })
        );
      } else {
        console.log(
          `${opts.prefix} ${chalk.gray(`[${timestamp}]`)} ${chalk.white.bold(
            `[${requestId}]`
          )} ` +
            `${(methodColor[req.method.toUpperCase()] || chalk.magenta)(req.method.toUpperCase())} ${chalk.cyan(decodedUrl)}`
        );
      }
    }

    // File: Log incoming request with IP and a [REQUEST] tag.
    if (fileLogger) {
      const fileReqMsg = opts.fileLogging?.customFileRequestFormat
        ? opts.fileLogging.customFileRequestFormat({
            timestamp,
            requestId,
            method: req.method.toUpperCase(),
            url: decodedUrl,
            ip,
          })
        : `${opts.prefix} [${timestamp}] [REQUEST] [${requestId}] [IP: ${ip}] ${req.method.toUpperCase()} ${decodedUrl}`;
      fileLogger.info(fileReqMsg);
    }

    // When the response finishes, log the response details.
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const resTimestamp = dayjs().format(opts.timestampFormat);
      const { statusCode, statusMessage } = res;
      const statusStr = statusCode.toString();

      // Color the status code based on its range for console output.
      let coloredStatus: string;
      if (statusStr.startsWith('2')) {
        coloredStatus = chalk.cyan.bold(statusStr);
      } else if (statusStr.startsWith('4')) {
        coloredStatus = chalk.red.bold(statusStr);
      } else if (statusStr.startsWith('5')) {
        coloredStatus = chalk.magenta.bold(statusStr);
      } else {
        coloredStatus = chalk.bold(statusStr);
      }

      const coloredMethod = (
        methodColor[req.method.toUpperCase()] || chalk.magenta
      )(req.method.toUpperCase());
      const emoji = opts.enableEmoji ? getEmoji(statusCode) : '';

      // Console: Log response.
      if (shouldLog(statusCode, opts.logLevel!)) {
        if (opts.customResponseFormat) {
          console.log(
            opts.customResponseFormat({
              timestamp: resTimestamp,
              requestId,
              statusCode,
              statusMessage,
              method: req.method.toUpperCase(),
              url: decodedUrl,
              duration,
              emoji,
            })
          );
        } else {
          console.log(
            `${opts.prefix} ${chalk.gray(`[${resTimestamp}]`)} ${chalk.white.bold(
              `[${requestId}]`
            )} ` +
              `${coloredStatus} ${coloredMethod} ${chalk.cyan(decodedUrl)} -> ${statusMessage} ${emoji} - ${duration}ms`
          );
        }
      }

      // File: Log response with IP and a [RESPONSE] tag.
      // Ordering: METHOD CODE EMOJI MESSAGE TIMEELAPSED
      if (fileLogger) {
        const fileResMsg = opts.fileLogging?.customFileResponseFormat
          ? opts.fileLogging.customFileResponseFormat({
              timestamp: resTimestamp,
              requestId,
              statusCode,
              statusMessage,
              method: req.method.toUpperCase(),
              url: decodedUrl,
              duration,
              emoji,
              ip,
            })
          : `${opts.prefix} [${resTimestamp}] [RESPONSE] [${requestId}] [IP: ${ip}] ` +
            `${req.method.toUpperCase()} ${statusCode} ${emoji} ${statusMessage} - ${duration}ms`;
        fileLogger.info(fileResMsg);
      }
    });

    // Log response errors to console and file.
    res.on('error', (err: Error) => {
      const errorMsg =
        `${opts.prefix} ${chalk.gray(
          `[${dayjs().format(opts.timestampFormat)}]`
        )} ${chalk.white.bold(`[${requestId}]`)} ${chalk.red('ERROR')} ` +
        `${chalk.cyan(req.method.toUpperCase())} ${chalk.cyan(decodedUrl)} - ${err.message}`;
      console.error(errorMsg);
      if (fileLogger) {
        fileLogger.error(errorMsg);
      }
    });

    next();
  };
};
