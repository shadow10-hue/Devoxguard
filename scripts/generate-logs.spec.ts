import {
  generateBurstTraffic,
  generateOriginShiftTraffic,
  generateRegularTraffic,
  generateSequentialIdScan,
} from './generate-logs';

describe('generate-logs', () => {
  it('generateRegularTraffic produces the requested count with monotonically increasing timestamps', () => {
    const entries = generateRegularTraffic(10, 5000);
    expect(entries).toHaveLength(10);
    for (let i = 1; i < entries.length; i += 1) {
      expect(entries[i].timestamp).toBeGreaterThan(entries[i - 1].timestamp);
    }
  });

  it('generateBurstTraffic appends the burst after the baseline', () => {
    const entries = generateBurstTraffic(20, 5000, 10, 1000);
    expect(entries).toHaveLength(30);
    const baselineLast = entries[19].timestamp;
    const burstFirst = entries[20].timestamp;
    expect(burstFirst - baselineLast).toBeLessThan(5000);
  });

  it('generateSequentialIdScan assigns consecutive numeric requestedId values', () => {
    const entries = generateSequentialIdScan(1, 5, 500);
    expect(entries.map((e) => e.requestedId)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('generateOriginShiftTraffic switches originIp at the given index', () => {
    const entries = generateOriginShiftTraffic(10, 1000, 5, '203.0.113.7');
    expect(entries.slice(0, 5).every((e) => e.originIp === '10.0.0.1')).toBe(true);
    expect(entries.slice(5).every((e) => e.originIp === '203.0.113.7')).toBe(true);
  });
});
