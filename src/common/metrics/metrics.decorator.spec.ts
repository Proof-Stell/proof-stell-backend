import { register } from 'prom-client';
import { Metrics, blockchainMetrics, incrementCacheResult, observeCacheOperation } from './metrics.decorator';

class InstrumentedService {
  @Metrics({ ...blockchainMetrics, operation: 'mint' })
  async succeeds(): Promise<void> {}

  @Metrics({ ...blockchainMetrics, operation: 'burn' })
  async fails(): Promise<void> {
    throw new TypeError('Rejected transaction');
  }
}

describe('Prometheus instrumentation', () => {
  const service = new InstrumentedService();

  it('emits transaction success, error, and duration metrics', async () => {
    await service.succeeds();
    await expect(service.fails()).rejects.toThrow('Rejected transaction');

    const transactions = await register.getSingleMetric('blockchain_transaction_total')!.get();
    const errors = await register.getSingleMetric('blockchain_transaction_errors_total')!.get();
    const durations = await register.getSingleMetric('blockchain_transaction_duration_ms')!.get();

    expect(transactions.values).toEqual(expect.arrayContaining([
      expect.objectContaining({ labels: { method: 'mint', status: 'success' }, value: 1 }),
      expect.objectContaining({ labels: { method: 'burn', status: 'error' }, value: 1 }),
    ]));
    expect(errors.values).toEqual(expect.arrayContaining([
      expect.objectContaining({ labels: { method: 'burn', error_type: 'TypeError' }, value: 1 }),
    ]));
    expect(durations.values.some((sample) => sample.labels.method === 'mint')).toBe(true);
  });

  it('emits cache hit, miss, and operation duration metrics', async () => {
    incrementCacheResult('hit');
    incrementCacheResult('miss');
    observeCacheOperation('get', Date.now() - 2);

    const hits = await register.getSingleMetric('cache_hit_total')!.get();
    const misses = await register.getSingleMetric('cache_miss_total')!.get();
    const durations = await register.getSingleMetric('cache_operation_duration_ms')!.get();

    expect(hits.values.some((sample) => sample.value >= 1)).toBe(true);
    expect(misses.values.some((sample) => sample.value >= 1)).toBe(true);
    expect(durations.values.some((sample) => sample.labels.operation === 'get')).toBe(true);
  });
});
