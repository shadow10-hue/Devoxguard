import { Controller, Get, Query } from '@nestjs/common';
import { ProductsService, ProductRow } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  /**
   * GET /products/search?q=<term>. Deliberately vulnerable to SQL injection
   * via the `q` parameter (see ProductsService.search). Returns [] for a
   * missing/empty term rather than dumping the whole table.
   */
  @Get('search')
  search(@Query('q') q?: string): ProductRow[] {
    if (q === undefined || q === '') return [];
    return this.productsService.search(q);
  }
}
