import { v4 as uuidv4 } from 'uuid';
import { Detector } from './detector.interface';
import { RequestContext } from '../request-context';
import { Finding } from '../../storage/finding.schema';

const SENSITIVE_FIELDS = ['passwordHash'];

/**
 * Hardcoded equivalent of the default `excessive-exposure-profile` DSL
 * rule (see rules/default-rules/excessive-exposure-profile.yml). Unlike
 * idor/mass-assignment, this class is kept active alongside its YAML
 * twin rather than superseded — see pipeline-parity.spec.ts. Response-
 * phase only: never blocks, only logs, since the handler has already
 * produced the response body by the time this runs.
 */
export class ExcessiveExposureDetector implements Detector {
  readonly name = 'excessive-exposure-profile';

  detect(context: RequestContext, responseBody?: unknown): Finding[] {
    if (context.route !== '/users/:id/profile' || context.method !== 'GET') return [];
    if (!responseBody || typeof responseBody !== 'object') return [];

    const exposedField = SENSITIVE_FIELDS.find((field) => field in (responseBody as Record<string, unknown>));
    if (!exposedField) return [];

    return [
      {
        id: uuidv4(),
        requestId: context.requestId,
        type: 'excessive-exposure',
        severity: 'medium',
        route: context.route,
        method: context.method,
        userId: context.authenticatedUser?.id ?? null,
        detail: `Response field '${exposedField}' should not be exposed to the client`,
        actionTaken: 'logged',
        timestamp: context.timestamp,
      },
    ];
  }
}
