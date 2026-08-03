import { RequestContext } from '../request-context';
import { Finding } from '../../storage/finding.schema';

export interface Detector {
  readonly name: string;
  detect(context: RequestContext, responseBody?: unknown): Finding[];
}
