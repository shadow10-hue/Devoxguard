import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { InternalApiKeyGuard } from '../guard/internal-api-key.guard';
import { FindingsPage, MongoFindingRepository, StoredFinding } from '../storage/mongo.repository';

@UseGuards(InternalApiKeyGuard)
@Controller('devoxguard/api/findings')
export class FindingsController {
  constructor(private readonly repository: MongoFindingRepository) {}

  @Get()
  list(
    @Query('type') type?: string,
    @Query('severity') severity?: string,
    @Query('route') route?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<FindingsPage> {
    return this.repository.findPage({
      type,
      severity,
      route,
      from: from !== undefined ? Number(from) : undefined,
      to: to !== undefined ? Number(to) : undefined,
      page: page !== undefined ? Number(page) : undefined,
      pageSize: pageSize !== undefined ? Number(pageSize) : undefined,
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<StoredFinding> {
    const finding = await this.repository.findById(id);
    if (!finding) throw new NotFoundException(`Finding ${id} not found`);
    return finding;
  }
}
