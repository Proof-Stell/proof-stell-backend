import { Counter, Gauge, Histogram, register } from 'prom-client';

type MetricLabels = Record<string, string>;

export interface MetricsOptions {
  operation?: string;
  durationMetric?: string;
  totalMetric?: string;
  errorMetric?: string;
  labelName?: string;
}

const metric = <T>(name: string, create: () => T): T =>
  (register.getSingleMetric(name) as T | undefined) ?? create();

const histogram = (name: string, help: string, labelNames: string[]) =>
  metric(name, () => new Histogram({ name, help, labelNames, buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] }));

const counter = (name: string, help: string, labelNames: string[]) =>
  metric(name, () => new Counter({ name, help, labelNames }));

const errorType = (error: unknown): string => {
  const name = error instanceof Error ? error.name : 'UnknownError';
  return name.replace(/[^a-zA-Z0-9_]/g, '_') || 'UnknownError';
};

export function observeOperation(options: MetricsOptions, operation: string, startedAt: number, status: 'success' | 'error', error?: unknown): void {
  const labelName = options.labelName ?? 'operation';
  const labels: MetricLabels = { [labelName]: operation };
  const durationMetric = options.durationMetric ?? 'application_operation_duration_ms';
  const totalMetric = options.totalMetric ?? 'application_operation_total';
  const errorsMetric = options.errorMetric ?? 'application_operation_errors_total';

  histogram(durationMetric, 'Duration of instrumented application operations in milliseconds', [labelName]).observe(labels, Date.now() - startedAt);
  counter(totalMetric, 'Total instrumented application operations', [labelName, 'status']).inc({ ...labels, status });
  if (status === 'error') {
    counter(errorsMetric, 'Total instrumented application operation errors', [labelName, 'error_type']).inc({ ...labels, error_type: errorType(error) });
  }
}

/** Instruments synchronous and asynchronous service methods using the shared Prometheus registry. */
export function Metrics(options: MetricsOptions = {}): MethodDecorator {
  return (_target, propertyKey, descriptor: PropertyDescriptor) => {
    const original = descriptor.value;
    const operation = options.operation ?? String(propertyKey);

    descriptor.value = function (...args: unknown[]) {
      const startedAt = Date.now();
      try {
        const result = original.apply(this, args);
        if (result && typeof result.then === 'function') {
          return result.then(
            (value: unknown) => {
              observeOperation(options, operation, startedAt, 'success');
              return value;
            },
            (error: unknown) => {
              observeOperation(options, operation, startedAt, 'error', error);
              throw error;
            },
          );
        }
        observeOperation(options, operation, startedAt, 'success');
        return result;
      } catch (error) {
        observeOperation(options, operation, startedAt, 'error', error);
        throw error;
      }
    };
    return descriptor;
  };
}

export const blockchainMetrics: MetricsOptions = {
  durationMetric: 'blockchain_transaction_duration_ms',
  totalMetric: 'blockchain_transaction_total',
  errorMetric: 'blockchain_transaction_errors_total',
  labelName: 'method',
};

export function observeCacheOperation(operation: string, startedAt: number): void {
  histogram('cache_operation_duration_ms', 'Cache operation duration in milliseconds', ['operation'])
    .observe({ operation }, Date.now() - startedAt);
}

export function incrementCacheResult(result: 'hit' | 'miss'): void {
  counter(`cache_${result}_total`, `Total cache ${result}es`, []).inc();
}

export function observeDatabaseQuery(queryType: string, startedAt: number): void {
  histogram('database_query_duration_ms', 'Database query duration in milliseconds', ['query_type'])
    .observe({ query_type: queryType }, Date.now() - startedAt);
}

export function observeDatabaseTransaction(startedAt: number): void {
  histogram('database_transaction_duration_ms', 'Database transaction duration in milliseconds', ['operation'])
    .observe({ operation: 'transaction' }, Date.now() - startedAt);
}

export function setDatabasePoolMetrics(size: number, available: number): void {
  (metric('database_connection_pool_size', () => new Gauge({ name: 'database_connection_pool_size', help: 'Current database connection pool size' })) as Gauge<string>)
    .set(size);
  (metric('database_available_connections', () => new Gauge({ name: 'database_available_connections', help: 'Available database connections in the pool' })) as Gauge<string>)
    .set(available);
}
