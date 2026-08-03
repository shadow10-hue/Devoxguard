import { Controller, Get, UseGuards } from '@nestjs/common';
import { InternalApiKeyGuard } from '../guard/internal-api-key.guard';
import { RuleRegistry } from '../rules/rule-registry';
import { CompiledRule } from '../rules/rule.types';

@UseGuards(InternalApiKeyGuard)
@Controller('devoxguard/api/rules')
export class RulesController {
  constructor(private readonly ruleRegistry: RuleRegistry) {}

  @Get()
  list(): CompiledRule[] {
    return this.ruleRegistry.getRules();
  }
}
