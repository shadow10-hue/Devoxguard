import { Controller, Get, UseGuards } from '@nestjs/common';
import { InternalApiKeyGuard } from '../guard/internal-api-key.guard';
import { AnomalyScoreTrendTracker } from '../anomaly/anomaly-score-trend.tracker';
import { MongoFindingRepository, RuleTriggerCount } from '../storage/mongo.repository';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface OverviewStats {
  blockedLast24h: number;
  topRulesTriggered: RuleTriggerCount[];
  averageAnomalyScoreTrend: { timestamp: number; score: number }[];
}

@UseGuards(InternalApiKeyGuard)
@Controller('devoxguard/api/stats')
export class StatsController {
  constructor(
    private readonly repository: MongoFindingRepository,
    private readonly trendTracker: AnomalyScoreTrendTracker,
  ) {}

  @Get('overview')
  async overview(): Promise<OverviewStats> {
    const [blockedLast24h, topRulesTriggered] = await Promise.all([
      this.repository.countBlockedSince(Date.now() - ONE_DAY_MS),
      this.repository.topRulesTriggered(5),
    ]);

    return {
      blockedLast24h,
      topRulesTriggered,
      averageAnomalyScoreTrend: this.trendTracker.getTrend(),
    };
  }
}
