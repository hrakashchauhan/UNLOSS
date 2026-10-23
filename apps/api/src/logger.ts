export interface LogFields {
  requestId?: string;
  method?: string;
  route?: string;
  status?: number;
  durationMs?: number;
  code?: string;
  port?: number;
  mode?: 'demo' | 'manual';
  fields?: string[];
}

export interface Logger {
  info(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

/** Only explicit metadata is accepted; no request bodies, URLs, headers, or errors. */
export function createLogger(write: (line: string) => void = line => process.stdout.write(`${line}\n`)): Logger {
  const log = (level: 'info' | 'error', event: string, fields: LogFields = {}) => {
    const { requestId, method, route, status, durationMs, code, port, mode, fields: invalidFields } = fields;
    write(JSON.stringify({
      timestamp: new Date().toISOString(), level, event,
      requestId, method, route, status, durationMs, code, port, mode, fields: invalidFields,
    }));
  };
  return { info: (event, fields) => log('info', event, fields), error: (event, fields) => log('error', event, fields) };
}
