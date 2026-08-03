import { v4 as uuidv4 } from 'uuid';
import { Detector } from './detector.interface';
import { RequestContext } from '../request-context';
import { Finding } from '../../storage/finding.schema';

/**
 * Hardcoded equivalent of the default `idor-orders` DSL rule (see
 * rules/default-rules/idor-orders.yml, introduced once the DSL exists).
 */
export class IdorDetector implements Detector {
  readonly name = 'idor-orders';

  detect(context: RequestContext): Finding[] {
    if (context.route !== '/orders/:id' || context.method !== 'GET') return [];

    const requestedId = context.params.id;
    if (requestedId === undefined) return [];

    const ownedOrderIds = context.authenticatedUser?.ownedResourceIds?.orders ?? [];
    if (ownedOrderIds.includes(requestedId)) return [];

    return [
      {
        id: uuidv4(),
        requestId: context.requestId,
        type: 'idor',
        severity: 'high',
        route: context.route,
        method: context.method,
        userId: context.authenticatedUser?.id ?? null,
        detail: `Requested order id '${requestedId}' is not owned by the authenticated user`,
        actionTaken: 'blocked',
        timestamp: context.timestamp,
      },
    ];
  }
}
