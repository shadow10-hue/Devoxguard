import { v4 as uuidv4 } from 'uuid';
import { Detector } from './detector.interface';
import { RequestContext } from '../request-context';
import { Finding } from '../../storage/finding.schema';

const FORBIDDEN_FIELDS = ['role', 'isAdmin'];

/**
 * Hardcoded equivalent of the default `mass-assignment-users` DSL rules
 * (see rules/default-rules/mass-assignment-users.yml). Superseded by
 * those rules in the standard pipeline (guard/devoxguard.guard.ts uses
 * rule-evaluator.ts against the loaded CompiledRule[] instead of this
 * class); retained as an extensibility example/fallback for
 * mass-assignment logic too specific to express in the DSL (see
 * pipeline-parity.spec.ts for the equivalence check between the two
 * paths).
 */
export class MassAssignmentDetector implements Detector {
  readonly name = 'mass-assignment-users';

  detect(context: RequestContext): Finding[] {
    if (context.route !== '/users/:id' || context.method !== 'PATCH') return [];
    if (!context.body) return [];

    const injectedField = FORBIDDEN_FIELDS.find((field) => field in context.body!);
    if (!injectedField) return [];

    return [
      {
        id: uuidv4(),
        requestId: context.requestId,
        type: 'mass-assignment',
        severity: 'high',
        route: context.route,
        method: context.method,
        userId: context.authenticatedUser?.id ?? null,
        detail: `Field '${injectedField}' is not allowed to be set via this endpoint`,
        actionTaken: 'blocked',
        timestamp: context.timestamp,
      },
    ];
  }
}
