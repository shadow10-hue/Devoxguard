import { Controller, Get, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  findMine(@Req() req: Request) {
    return this.ordersService.listForUser(req.user?.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ordersService.findById(id);
  }
}
