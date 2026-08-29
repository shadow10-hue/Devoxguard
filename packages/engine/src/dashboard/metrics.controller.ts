import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { InternalApiKeyGuard } from '../guard/internal-api-key.guard';
import { metricsRegistry } from './metrics';

/**
 * Unlike HealthController (deliberately key-free — orchestrators need
 * it), this is guarded like FindingsController/RulesController/
 * StatsController: no orchestrator healthcheck consumes it, and an
 * unauthenticated caller could infer request volume / attack rate from
 * it, so it gets the same protection as findings data.
 */
@UseGuards(InternalApiKeyGuard)
@Controller('devoxguard/metrics')
export class MetricsController {
  @Get()
  @Header('Content-Type', metricsRegistry.contentType)
  async getMetrics(): Promise<string> {
    return metricsRegistry.metrics();
  }
}
