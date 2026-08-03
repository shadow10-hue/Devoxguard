export const DEVOXGUARD_ENGINE_VERSION = '0.1.0';

export * from './analysis/request-context';
export * from './analysis/request-analysis.interceptor';
export * from './analysis/response-analysis.interceptor';
export * from './analysis/detectors/detector.interface';
export * from './analysis/detectors/idor.detector';
export * from './analysis/detectors/mass-assignment.detector';
export * from './analysis/detectors/excessive-exposure.detector';
export * from './storage/finding.schema';
